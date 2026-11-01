-- Bind receipt claims to the current database order total. Never trust the
-- cashier's browser to choose the amount that a manager will review.
create unique index paybill_claim_one_pending_order_idx
  on public.paybill_claims(order_id) where status = 'pending';

create or replace function private.guard_paybill_claim()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target public.lounge_orders;
begin
  if (select auth.uid()) is null or new.submitted_by <> (select auth.uid())
    or not (select private.has_cashier_role()) then
    raise exception 'Cashier access is required to submit a payment claim' using errcode='42501';
  end if;
  select * into target from public.lounge_orders where id = new.order_id for update;
  if not found or target.status <> 'open' or target.payment_status <> 'unpaid' then
    raise exception 'The order is no longer open for payment' using errcode='22023';
  end if;
  new.amount_cents := target.total_cents;
  new.provider_receipt := upper(trim(new.provider_receipt));
  new.created_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_paybill_claim() from public, anon, authenticated;
create trigger paybill_claim_guard before insert on public.paybill_claims
for each row execute function private.guard_paybill_claim();

create or replace function public.apply_mpesa_stk_callback(
  p_callback_token text, p_checkout_request_id text, p_result_code integer,
  p_receipt text, p_amount_cents bigint
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare attempt public.payment_attempts;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service callback only' using errcode='42501'; end if;
  select * into attempt from public.payment_attempts
    where callback_token = p_callback_token and checkout_request_id = p_checkout_request_id for update;
  if not found then return false; end if;
  if attempt.status = 'paid' then return true; end if;
  if p_result_code <> 0 then
    update public.payment_attempts set status = 'failed', completed_at = statement_timestamp() where id = attempt.id;
    return true;
  end if;
  if p_receipt is null or p_amount_cents is distinct from attempt.expected_amount_cents
    or exists(select 1 from public.payment_attempts where mpesa_receipt = p_receipt and id <> attempt.id) then
    update public.payment_attempts set status = 'review', completed_at = statement_timestamp() where id = attempt.id;
    return true;
  end if;
  begin
    update public.payment_attempts set status = 'paid', mpesa_receipt = p_receipt, completed_at = statement_timestamp() where id = attempt.id;
    perform private.settle_lounge_order(attempt.order_id, p_amount_cents, attempt.requested_by, 'mpesa_stk:' || p_receipt);
  exception when others then
    update public.payment_attempts set status = 'review', mpesa_receipt = null, completed_at = statement_timestamp() where id = attempt.id;
  end;
  return true;
end;
$$;
revoke all on function public.apply_mpesa_stk_callback(text,text,integer,text,bigint) from public, anon, authenticated;
grant execute on function public.apply_mpesa_stk_callback(text,text,integer,text,bigint) to service_role;

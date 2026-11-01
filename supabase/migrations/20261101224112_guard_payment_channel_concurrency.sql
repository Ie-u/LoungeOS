create unique index payment_attempts_one_pending_per_order_idx
  on public.payment_attempts(order_id) where status='pending';

create or replace function private.guard_payment_channel_exclusivity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target public.lounge_orders;
begin
  select * into target from public.lounge_orders where id=new.order_id for update;
  if not found or target.status <> 'open' or target.payment_status <> 'unpaid' then
    raise exception 'The order is not open for a new payment request' using errcode='22023';
  end if;
  if exists(select 1 from public.payment_attempts where order_id=new.order_id and status='pending')
    or exists(select 1 from public.paybill_claims where order_id=new.order_id and status='pending')
    or exists(select 1 from public.mpesa_c2b_transactions where matched_order_id=new.order_id and status in ('matched','ambiguous')) then
    raise exception 'Another payment request or receipt is awaiting resolution for this order' using errcode='23505';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payment_channel_exclusivity() from public, anon, authenticated;
create trigger payment_attempt_exclusivity before insert on public.payment_attempts
for each row execute function private.guard_payment_channel_exclusivity();
create trigger paybill_claim_exclusivity before insert on public.paybill_claims
for each row execute function private.guard_payment_channel_exclusivity();
create or replace function public.review_paybill_claim(p_claim_id uuid, p_approve boolean, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); claim public.paybill_claims;
begin
  if actor is null or not (select private.has_management_role()) then
    raise exception 'Manager access is required to verify manual payment claims' using errcode='42501';
  end if;
  if char_length(trim(coalesce(p_reason,''))) < 5 or char_length(p_reason) > 300 then
    raise exception 'Provide a review reason between 5 and 300 characters' using errcode='22023';
  end if;
  select * into claim from public.paybill_claims where id=p_claim_id and status='pending' for update;
  if not found then raise exception 'Payment claim is no longer pending' using errcode='22023'; end if;
  if p_approve and exists(select 1 from public.payment_attempts where order_id=claim.order_id and status='pending') then
    raise exception 'An M-Pesa STK request is still pending for this order' using errcode='23505';
  end if;
  if p_approve and exists(select 1 from public.payment_attempts where mpesa_receipt=upper(claim.provider_receipt) and status='paid') then
    raise exception 'This receipt is already recorded on an M-Pesa STK payment' using errcode='23505';
  end if;
  if p_approve and exists(select 1 from public.mpesa_c2b_transactions where upper(transaction_id)=upper(claim.provider_receipt) and status <> 'rejected') then
    raise exception 'This receipt has a Daraja C2B callback; reconcile it in the provider transaction queue' using errcode='23505';
  end if;
  update public.paybill_claims set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=actor, review_reason=trim(p_reason), reviewed_at=statement_timestamp() where id=claim.id;
  if p_approve then perform private.settle_lounge_order(claim.order_id, claim.amount_cents, actor, 'paybill:' || claim.provider_receipt); end if;
end;
$$;
revoke all on function public.review_paybill_claim(uuid,boolean,text) from public, anon;
grant execute on function public.review_paybill_claim(uuid,boolean,text) to authenticated;
create or replace function public.review_mpesa_c2b_transaction(
  p_transaction_id text, p_payment_reference text, p_approve boolean, p_reason text
) returns void language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); tx public.mpesa_c2b_transactions; target public.lounge_orders;
begin
  if actor is null or not (select private.has_management_role()) then
    raise exception 'Manager access is required to reconcile M-Pesa transactions' using errcode='42501';
  end if;
  if char_length(trim(coalesce(p_reason,''))) < 5 or char_length(p_reason) > 300 then
    raise exception 'Provide a review reason between 5 and 300 characters' using errcode='22023';
  end if;
  select * into tx from public.mpesa_c2b_transactions
    where transaction_id=trim(p_transaction_id) and status in ('unmatched','matched','ambiguous') for update;
  if not found then raise exception 'M-Pesa transaction is no longer awaiting review' using errcode='22023'; end if;
  if not p_approve then
    update public.mpesa_c2b_transactions set status='rejected', reviewed_by=actor,
      reviewed_at=statement_timestamp(), review_reason=trim(p_reason) where id=tx.id;
    return;
  end if;
  select * into target from public.lounge_orders
    where payment_reference=upper(trim(coalesce(p_payment_reference,''))) for update;
  if not found or target.status <> 'open' or target.payment_status <> 'unpaid' or target.total_cents <> tx.amount_cents then
    raise exception 'Choose an open unpaid order with the exact confirmed M-Pesa amount' using errcode='22023';
  end if;
  if exists(select 1 from public.payment_attempts where order_id=target.id and status='pending') then
    raise exception 'An M-Pesa STK request is still pending for this order' using errcode='23505';
  end if;
  if exists(select 1 from public.payment_attempts where mpesa_receipt=tx.transaction_id and status='paid') then
    raise exception 'This M-Pesa transaction is already recorded on an STK payment' using errcode='23505';
  end if;
  perform private.settle_lounge_order(target.id,tx.amount_cents,actor,'mpesa_c2b:' || tx.transaction_id);
  update public.mpesa_c2b_transactions set status='settled', matched_order_id=target.id,
    reviewed_by=actor, reviewed_at=statement_timestamp(), review_reason=trim(p_reason) where id=tx.id;
  update public.paybill_claims set status='rejected', reviewed_by=actor, reviewed_at=statement_timestamp(),
    review_reason='Same receipt reconciled from the Daraja C2B confirmation.'
    where provider_receipt=upper(tx.transaction_id) and status='pending';
end;
$$;
revoke all on function public.review_mpesa_c2b_transaction(text,text,boolean,text) from public, anon;
grant execute on function public.review_mpesa_c2b_transaction(text,text,boolean,text) to authenticated;

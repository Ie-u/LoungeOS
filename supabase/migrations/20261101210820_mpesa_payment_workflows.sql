-- Payment evidence is retained separately from orders. Orders become paid only
-- after a provider callback or an authorized review of a Paybill/Till claim.
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lounge_orders(id),
  provider text not null default 'mpesa_stk' check (provider = 'mpesa_stk'),
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled','review')),
  expected_amount_cents bigint not null check (expected_amount_cents > 0),
  phone_number text not null check (phone_number ~ '^254[17][0-9]{8}$'),
  merchant_request_id text,
  checkout_request_id text unique,
  mpesa_receipt text unique,
  callback_token text not null unique,
  requested_by uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index payment_attempts_order_created_idx on public.payment_attempts(order_id, created_at desc);
alter table public.payment_attempts enable row level security;
create policy "Cashiers and managers read payment attempts" on public.payment_attempts
for select to authenticated using ((select private.has_cashier_role()));
revoke all on public.payment_attempts from public, anon, authenticated;
grant select on public.payment_attempts to authenticated;

create table public.paybill_claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lounge_orders(id),
  amount_cents bigint not null check (amount_cents > 0),
  provider_receipt text not null unique check (char_length(trim(provider_receipt)) between 4 and 32),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_by uuid not null references public.staff_profiles(user_id),
  reviewed_by uuid references public.staff_profiles(user_id),
  review_reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check ((status = 'pending' and reviewed_by is null and reviewed_at is null)
      or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null))
);
create index paybill_claims_status_created_idx on public.paybill_claims(status, created_at desc);
alter table public.paybill_claims enable row level security;
create policy "Cashiers and managers read Paybill claims" on public.paybill_claims
for select to authenticated using ((select private.has_cashier_role()));
create policy "Cashiers submit Paybill claims" on public.paybill_claims
for insert to authenticated with check ((select private.has_cashier_role()) and submitted_by = (select auth.uid()));
revoke all on public.paybill_claims from public, anon, authenticated;
grant select on public.paybill_claims to authenticated;
grant insert (order_id, amount_cents, provider_receipt, submitted_by) on public.paybill_claims to authenticated;

create or replace function private.settle_lounge_order(p_order_id uuid, p_amount_cents bigint, p_actor uuid, p_evidence text)
returns void language plpgsql security definer set search_path = ''
as $$
declare target public.lounge_orders;
begin
  select * into target from public.lounge_orders where id = p_order_id for update;
  if not found or target.status <> 'open' or target.payment_status <> 'unpaid' or target.total_cents <> p_amount_cents then
    raise exception 'Payment does not match an open unpaid order' using errcode = '22023';
  end if;
  update public.lounge_orders set payment_status = 'paid', paid_by = p_actor, paid_at = statement_timestamp()
    where id = p_order_id;
  insert into public.audit_events(actor_id, entity_type, entity_id, action, before_data, after_data)
    values (p_actor, 'lounge_order', p_order_id, 'payment_verified',
      jsonb_build_object('payment_status','unpaid'), jsonb_build_object('payment_status','paid','evidence',p_evidence));
end;
$$;
revoke all on function private.settle_lounge_order(uuid,bigint,uuid,text) from public, anon, authenticated;

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
  if p_receipt is null or p_amount_cents is distinct from attempt.expected_amount_cents then
    update public.payment_attempts set status = 'review', completed_at = statement_timestamp() where id = attempt.id;
    return true;
  end if;
  update public.payment_attempts set status = 'paid', mpesa_receipt = p_receipt, completed_at = statement_timestamp() where id = attempt.id;
  perform private.settle_lounge_order(attempt.order_id, p_amount_cents, attempt.requested_by, 'mpesa_stk:' || p_receipt);
  return true;
end;
$$;
revoke all on function public.apply_mpesa_stk_callback(text,text,integer,text,bigint) from public, anon, authenticated;
grant execute on function public.apply_mpesa_stk_callback(text,text,integer,text,bigint) to service_role;

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
  update public.paybill_claims set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=actor, review_reason=trim(p_reason), reviewed_at=statement_timestamp() where id=claim.id;
  if p_approve then perform private.settle_lounge_order(claim.order_id, claim.amount_cents, actor, 'paybill:' || claim.provider_receipt); end if;
end;
$$;
revoke all on function public.review_paybill_claim(uuid,boolean,text) from public, anon;
grant execute on function public.review_paybill_claim(uuid,boolean,text) to authenticated;

-- The former generic payment toggle bypassed verification. Keep its signature
-- for old clients, but deny access; settlement now has evidence-specific paths.
revoke all on function public.mark_lounge_order_paid(uuid) from public, anon, authenticated;

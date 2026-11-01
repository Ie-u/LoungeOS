alter table public.lounge_orders
  add column payment_reference text generated always as
    ('LO-' || upper(substr(replace(id::text, '-', ''), 1, 10))) stored;
create unique index lounge_orders_payment_reference_key on public.lounge_orders(payment_reference);

create table public.mpesa_c2b_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique check (char_length(trim(transaction_id)) between 4 and 40),
  bill_reference text not null default '' check (char_length(bill_reference) <= 100),
  amount_cents bigint not null check (amount_cents > 0),
  transacted_at timestamptz,
  status text not null default 'unmatched' check (status in ('unmatched','matched','ambiguous','settled','rejected')),
  matched_order_id uuid references public.lounge_orders(id),
  received_at timestamptz not null default now(),
  reviewed_by uuid references public.staff_profiles(user_id),
  reviewed_at timestamptz,
  review_reason text,
  check ((status in ('settled','rejected') and reviewed_by is not null and reviewed_at is not null)
      or (status not in ('settled','rejected') and reviewed_by is null and reviewed_at is null))
);
create index mpesa_c2b_queue_idx on public.mpesa_c2b_transactions(status, received_at desc);
alter table public.mpesa_c2b_transactions enable row level security;
create policy "Managers review M-Pesa C2B transactions" on public.mpesa_c2b_transactions
for select to authenticated using ((select private.has_management_role()));
revoke all on public.mpesa_c2b_transactions from public, anon, authenticated;
grant select on public.mpesa_c2b_transactions to authenticated;

create function public.accept_mpesa_c2b_confirmation(
  p_transaction_id text, p_bill_reference text, p_amount_cents bigint, p_transacted_at timestamptz
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare new_rows integer; target public.lounge_orders; normalized_reference text; collision boolean; next_status text;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service callback only' using errcode='42501'; end if;
  if char_length(trim(coalesce(p_transaction_id,''))) not between 4 and 40
    or p_amount_cents is null or p_amount_cents <= 0
    or char_length(coalesce(p_bill_reference,'')) > 100 then
    raise exception 'M-Pesa confirmation payload is invalid' using errcode='22023';
  end if;
  normalized_reference := upper(trim(coalesce(p_bill_reference,'')));
  insert into public.mpesa_c2b_transactions(transaction_id,bill_reference,amount_cents,transacted_at)
    values(trim(p_transaction_id),normalized_reference,p_amount_cents,p_transacted_at)
    on conflict(transaction_id) do nothing;
  get diagnostics new_rows = row_count;
  if new_rows = 0 then return true; end if;

  select * into target from public.lounge_orders where payment_reference=normalized_reference;
  if not found then
    update public.mpesa_c2b_transactions set status='unmatched' where transaction_id=trim(p_transaction_id);
    return true;
  end if;
  collision := exists(select 1 from public.payment_attempts where mpesa_receipt=trim(p_transaction_id))
    or exists(select 1 from public.paybill_claims where provider_receipt=upper(trim(p_transaction_id)));
  if target.status='open' and target.payment_status='unpaid' and target.total_cents=p_amount_cents and not collision then
    next_status := 'matched';
  else
    next_status := 'ambiguous';
  end if;
  update public.mpesa_c2b_transactions set status=next_status, matched_order_id=target.id
    where transaction_id=trim(p_transaction_id);
  return true;
end;
$$;
revoke all on function public.accept_mpesa_c2b_confirmation(text,text,bigint,timestamptz) from public, anon, authenticated;
grant execute on function public.accept_mpesa_c2b_confirmation(text,text,bigint,timestamptz) to service_role;

create function public.review_mpesa_c2b_transaction(
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

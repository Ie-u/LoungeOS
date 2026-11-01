revoke select on public.payment_attempts from authenticated;
grant select (id, order_id, provider, status, expected_amount_cents, merchant_request_id,
  checkout_request_id, mpesa_receipt, requested_by, created_at, completed_at)
  on public.payment_attempts to authenticated;

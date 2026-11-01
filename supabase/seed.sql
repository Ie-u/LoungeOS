-- Fictional starter catalog only. No staff accounts or customer data are seeded.
insert into public.shisha_options (name, duration_minutes, price_cents)
values ('Sample Session', 60, 0)
on conflict (name) do nothing;

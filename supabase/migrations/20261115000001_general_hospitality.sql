-- General hospitality tables to run alongside shisha operations.
create table public.lounge_tables (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (char_length(label) between 1 and 32),
  capacity integer not null default 4 check (capacity > 0),
  status text not null default 'available' check (status in ('available', 'occupied', 'reserved', 'maintenance')),
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  phone text check (phone is null or char_length(phone) <= 20),
  email text check (email is null or char_length(email) <= 100),
  created_at timestamptz not null default now()
);

create table public.general_services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  price_cents bigint not null check (price_cents >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 15 and 360),
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.table_bookings (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.lounge_tables(id),
  customer_id uuid not null references public.customers(id),
  service_id uuid references public.general_services(id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'reserved' check (status in ('reserved', 'active', 'completed', 'cancelled')),
  notes text check (notes is null or char_length(notes) <= 300),
  created_by uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index table_bookings_start_time_idx on public.table_bookings (start_time);
create index table_bookings_table_id_idx on public.table_bookings (table_id);
create index table_bookings_customer_id_idx on public.table_bookings (customer_id);
create index table_bookings_created_by_idx on public.table_bookings (created_by);

alter table public.lounge_tables enable row level security;
alter table public.customers enable row level security;
alter table public.general_services enable row level security;
alter table public.table_bookings enable row level security;

create policy "Staff can view tables" on public.lounge_tables for select to authenticated using ((select private.has_active_staff()));
create policy "Managers manage tables" on public.lounge_tables for all to authenticated using ((select private.has_management_role())) with check ((select private.has_management_role()));

create policy "Staff can view customers" on public.customers for select to authenticated using ((select private.has_active_staff()));
create policy "Cashiers manage customers" on public.customers for all to authenticated using ((select private.has_cashier_role())) with check ((select private.has_cashier_role()));

create policy "Staff can view services" on public.general_services for select to authenticated using ((select private.has_active_staff()));
create policy "Managers manage services" on public.general_services for all to authenticated using ((select private.has_management_role())) with check ((select private.has_management_role()));

create policy "Staff view bookings" on public.table_bookings for select to authenticated using ((select private.has_active_staff()));
create policy "Cashiers manage bookings" on public.table_bookings for all to authenticated using ((select private.has_cashier_role())) with check ((select private.has_cashier_role()) and created_by = (select auth.uid()));

grant select on public.lounge_tables, public.customers, public.general_services, public.table_bookings to authenticated;
grant insert, update, delete on public.customers, public.table_bookings to authenticated;
grant insert, update, delete on public.lounge_tables, public.general_services to authenticated;

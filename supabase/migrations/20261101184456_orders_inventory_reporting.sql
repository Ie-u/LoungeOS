-- First working pass for lounge orders, stock movements, and operational reports.
-- All write paths validate the active staff role inside PostgreSQL.

create table public.lounge_orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.lounge_sessions(id) on delete set null,
  table_label text not null check (char_length(table_label) between 1 and 32),
  status text not null default 'open' check (status in ('open', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'cancelled')),
  total_cents bigint not null default 0 check (total_cents >= 0),
  created_by uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now(),
  paid_by uuid references public.staff_profiles(user_id),
  paid_at timestamptz,
  cancelled_by uuid references public.staff_profiles(user_id),
  cancelled_at timestamptz,
  check ((payment_status = 'paid' and paid_by is not null and paid_at is not null)
      or (payment_status <> 'paid' and paid_by is null and paid_at is null)),
  check ((status = 'cancelled' and cancelled_by is not null and cancelled_at is not null)
      or (status <> 'cancelled' and cancelled_by is null and cancelled_at is null))
);

create table public.lounge_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lounge_orders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  quantity integer not null check (quantity between 1 and 1000),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 1000000000),
  line_total_cents bigint generated always as (quantity::bigint * unit_price_cents) stored,
  created_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 100),
  unit text not null check (char_length(unit) between 1 and 32),
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  created_by uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  reason text not null check (char_length(reason) between 1 and 200),
  actor_id uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now()
);

create index lounge_orders_created_at_idx on public.lounge_orders (created_at desc);
create index lounge_orders_session_id_idx on public.lounge_orders (session_id) where session_id is not null;
create index lounge_order_items_order_id_idx on public.lounge_order_items (order_id);
create index inventory_movements_item_created_idx on public.inventory_movements (item_id, created_at desc);

alter table public.lounge_orders enable row level security;
alter table public.lounge_order_items enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;

create policy "Cashiers and managers can view lounge orders"
on public.lounge_orders for select to authenticated
using ((select private.has_cashier_role()));

create policy "Cashiers and managers can view order items"
on public.lounge_order_items for select to authenticated
using (exists (
  select 1 from public.lounge_orders o where o.id = order_id
));

create policy "Cashiers and managers can view inventory"
on public.inventory_items for select to authenticated
using ((select private.has_cashier_role()));

create policy "Cashiers and managers can view inventory movements"
on public.inventory_movements for select to authenticated
using ((select private.has_cashier_role()));

grant select on public.lounge_orders, public.lounge_order_items,
  public.inventory_items, public.inventory_movements to authenticated;
revoke all on public.lounge_orders, public.lounge_order_items,
  public.inventory_items, public.inventory_movements from anon, public;
revoke all on sequence public.inventory_movements_id_seq from anon, public, authenticated;

create function public.create_lounge_order(
  p_session_id uuid,
  p_table_label text,
  p_items jsonb
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_table text;
  new_order_id uuid;
  computed_total bigint;
  item record;
begin
  if actor is null or not (select private.has_cashier_role()) then
    raise exception 'Cashier or management access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Order items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Add between 1 and 20 order items' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(name text, quantity integer, unit_price_cents bigint)
    where coalesce(char_length(trim(item.name)), 0) not between 1 and 100
       or item.quantity is null or item.quantity not between 1 and 1000
       or item.unit_price_cents is null or item.unit_price_cents not between 0 and 1000000000
  ) then
    raise exception 'Order item details are invalid' using errcode = '22023';
  end if;
  select sum(item.quantity::bigint * item.unit_price_cents) into computed_total
  from jsonb_to_recordset(p_items) as item(name text, quantity integer, unit_price_cents bigint);
  if computed_total is null or computed_total > 9000000000000000000 then
    raise exception 'Order total is outside the supported range' using errcode = '22023';
  end if;
  if p_session_id is not null then
    select s.table_label into target_table
    from public.lounge_sessions s
    where s.id = p_session_id and s.status = 'active' and s.ends_at > now()
    for share;
    if target_table is null then
      raise exception 'Select an active lounge session' using errcode = '22023';
    end if;
  else
    target_table := trim(coalesce(p_table_label, ''));
    if char_length(target_table) not between 1 and 32 then
      raise exception 'Enter a table or customer label' using errcode = '22023';
    end if;
  end if;

  insert into public.lounge_orders (session_id, table_label, total_cents, created_by)
  values (p_session_id, target_table, computed_total, actor)
  returning id into new_order_id;

  for item in
    select * from jsonb_to_recordset(p_items) as item(name text, quantity integer, unit_price_cents bigint)
  loop
    insert into public.lounge_order_items (order_id, name, quantity, unit_price_cents)
    values (new_order_id, trim(item.name), item.quantity, item.unit_price_cents);
  end loop;

  insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
  values (actor, 'lounge_order', new_order_id, 'order_created',
    jsonb_build_object('table_label', target_table, 'total_cents', computed_total,
      'session_id', p_session_id, 'items', p_items));
  return new_order_id;
end;
$$;

create function public.mark_lounge_order_paid(p_order_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); updated_order public.lounge_orders;
begin
  if actor is null or not (select private.has_cashier_role()) then
    raise exception 'Cashier or management access is required' using errcode = '42501';
  end if;
  update public.lounge_orders
    set payment_status = 'paid', paid_by = actor, paid_at = now()
    where id = p_order_id and status = 'open' and payment_status = 'unpaid'
    returning * into updated_order;
  if not found then raise exception 'Order is not open and unpaid' using errcode = '40001'; end if;
  insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
  values (actor, 'lounge_order', updated_order.id, 'order_marked_paid',
    jsonb_build_object('payment_status', 'unpaid'),
    jsonb_build_object('payment_status', 'paid', 'paid_at', updated_order.paid_at));
end;
$$;

create function public.cancel_lounge_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); updated_order public.lounge_orders;
begin
  if actor is null or not (select private.has_cashier_role()) then
    raise exception 'Cashier or management access is required' using errcode = '42501';
  end if;
  update public.lounge_orders
    set status = 'cancelled', payment_status = 'cancelled', cancelled_by = actor, cancelled_at = now()
    where id = p_order_id and status = 'open' and payment_status = 'unpaid'
    returning * into updated_order;
  if not found then raise exception 'Only an unpaid open order can be cancelled' using errcode = '40001'; end if;
  insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
  values (actor, 'lounge_order', updated_order.id, 'order_cancelled',
    jsonb_build_object('status', 'open', 'payment_status', 'unpaid'),
    jsonb_build_object('status', 'cancelled', 'payment_status', 'cancelled', 'cancelled_at', updated_order.cancelled_at));
end;
$$;

create function public.create_inventory_item(
  p_name text, p_unit text, p_initial_quantity numeric, p_reorder_level numeric
) returns public.inventory_items language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); item public.inventory_items;
begin
  if actor is null or not (select private.has_management_role()) then
    raise exception 'Owner or admin access is required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 100
     or char_length(trim(coalesce(p_unit, ''))) not between 1 and 32
     or p_initial_quantity is null or p_initial_quantity < 0
     or p_reorder_level is null or p_reorder_level < 0 then
    raise exception 'Inventory item details are invalid' using errcode = '22023';
  end if;
  insert into public.inventory_items (name, unit, quantity, reorder_level, created_by)
  values (trim(p_name), trim(p_unit), p_initial_quantity, p_reorder_level, actor)
  returning * into item;
  if p_initial_quantity > 0 then
    insert into public.inventory_movements (item_id, quantity_delta, reason, actor_id)
    values (item.id, p_initial_quantity, 'Initial stock', actor);
  end if;
  insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
  values (actor, 'inventory_item', item.id, 'inventory_item_created',
    jsonb_build_object('name', item.name, 'unit', item.unit, 'quantity', item.quantity,
      'reorder_level', item.reorder_level));
  return item;
end;
$$;

create function public.adjust_inventory_stock(
  p_item_id uuid, p_quantity_delta numeric, p_reason text
) returns public.inventory_items language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); item public.inventory_items; old_quantity numeric;
begin
  if actor is null or not (select private.has_management_role()) then
    raise exception 'Owner or admin access is required' using errcode = '42501';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0
     or char_length(trim(coalesce(p_reason, ''))) not between 1 and 200 then
    raise exception 'Enter a nonzero adjustment and a reason' using errcode = '22023';
  end if;
  select * into item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  old_quantity := item.quantity;
  if old_quantity + p_quantity_delta < 0 then
    raise exception 'Stock cannot be reduced below zero' using errcode = '22023';
  end if;
  update public.inventory_items set quantity = old_quantity + p_quantity_delta, updated_at = now()
    where id = p_item_id returning * into item;
  insert into public.inventory_movements (item_id, quantity_delta, reason, actor_id)
  values (item.id, p_quantity_delta, trim(p_reason), actor);
  insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
  values (actor, 'inventory_item', item.id, 'inventory_adjusted',
    jsonb_build_object('quantity', old_quantity),
    jsonb_build_object('quantity', item.quantity, 'delta', p_quantity_delta,
      'reason', trim(p_reason), 'unit', item.unit));
  return item;
end;
$$;

revoke all on function public.create_lounge_order(uuid, text, jsonb) from public, anon;
revoke all on function public.mark_lounge_order_paid(uuid) from public, anon;
revoke all on function public.cancel_lounge_order(uuid) from public, anon;
revoke all on function public.create_inventory_item(text, text, numeric, numeric) from public, anon;
revoke all on function public.adjust_inventory_stock(uuid, numeric, text) from public, anon;
grant execute on function public.create_lounge_order(uuid, text, jsonb) to authenticated;
grant execute on function public.mark_lounge_order_paid(uuid) to authenticated;
grant execute on function public.cancel_lounge_order(uuid) to authenticated;
grant execute on function public.create_inventory_item(text, text, numeric, numeric) to authenticated;
grant execute on function public.adjust_inventory_stock(uuid, numeric, text) to authenticated;

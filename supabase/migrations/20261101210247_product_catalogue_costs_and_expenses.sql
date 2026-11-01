-- Products and prices are configured by owners/admins. Orders snapshot the
-- database price and optional cost; inventory is deducted only when selected.

alter table public.inventory_items
  add column sale_price_cents bigint check (sale_price_cents is null or sale_price_cents >= 0),
  add column unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  add column track_sales boolean not null default false,
  add column track_inventory boolean not null default false,
  add constraint inventory_sales_requires_price check (not track_sales or sale_price_cents is not null);

alter table public.lounge_order_items
  drop column line_total_cents,
  alter column quantity type numeric(12,3) using quantity::numeric,
  add column line_total_cents bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  add column inventory_item_id uuid references public.inventory_items(id) on delete set null,
  add column deduct_inventory boolean not null default false;
alter table public.lounge_order_items drop constraint lounge_order_items_quantity_check;
alter table public.lounge_order_items add constraint lounge_order_items_quantity_check check (quantity between 0.001 and 1000);

create table public.lounge_order_item_costs (
  order_item_id uuid primary key references public.lounge_order_items(id) on delete cascade,
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  created_at timestamptz not null default now()
);
alter table public.lounge_order_item_costs enable row level security;
create policy "Admins read order cost snapshots" on public.lounge_order_item_costs
for select to authenticated using ((select private.has_admin_role()));
revoke all on public.lounge_order_item_costs from public, anon, authenticated;
grant select on public.lounge_order_item_costs to authenticated;

create table public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (char_length(trim(category)) between 1 and 60),
  description text not null check (char_length(trim(description)) between 1 and 300),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 9000000000000000000),
  incurred_at timestamptz not null,
  recorded_by uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now()
);
create index business_expenses_incurred_at_idx on public.business_expenses (incurred_at desc);
alter table public.business_expenses enable row level security;
create policy "Admins read business expenses" on public.business_expenses
for select to authenticated using ((select private.has_admin_role()));
create policy "Admins append business expenses" on public.business_expenses
for insert to authenticated with check ((select private.has_admin_role()) and recorded_by = (select auth.uid()));
revoke all on public.business_expenses from public, anon, authenticated;
grant select, insert on public.business_expenses to authenticated;

create or replace function private.guard_business_expense()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.recorded_by <> (select auth.uid())
    or not (select private.has_admin_role()) then
    raise exception 'Owner or admin access is required to record expenses' using errcode = '42501';
  end if;
  new.created_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_business_expense() from public, anon, authenticated;
create trigger business_expense_guard before insert on public.business_expenses
for each row execute function private.guard_business_expense();

create or replace function private.audit_business_expense()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
  values (new.recorded_by, 'business_expense', new.id, 'expense_recorded',
    jsonb_build_object('category', new.category, 'amount_cents', new.amount_cents, 'incurred_at', new.incurred_at));
  return new;
end;
$$;
revoke all on function private.audit_business_expense() from public, anon, authenticated;
create trigger business_expense_audit after insert on public.business_expenses
for each row execute function private.audit_business_expense();

create or replace function private.guard_inventory_catalog_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.has_admin_role()) then
    raise exception 'Owner or admin access is required to change product pricing' using errcode = '42501';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_inventory_catalog_update() from public, anon, authenticated;
create trigger inventory_catalog_update_guard before update of sale_price_cents, unit_cost_cents, track_sales, track_inventory on public.inventory_items
for each row execute function private.guard_inventory_catalog_update();

create or replace function private.audit_inventory_catalog_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if row(old.sale_price_cents, old.unit_cost_cents, old.track_sales, old.track_inventory)
    is distinct from row(new.sale_price_cents, new.unit_cost_cents, new.track_sales, new.track_inventory) then
    insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
    values ((select auth.uid()), 'inventory_item', new.id, 'product_settings_changed',
      jsonb_build_object('sale_price_cents', old.sale_price_cents, 'unit_cost_cents', old.unit_cost_cents,
        'track_sales', old.track_sales, 'track_inventory', old.track_inventory),
      jsonb_build_object('sale_price_cents', new.sale_price_cents, 'unit_cost_cents', new.unit_cost_cents,
        'track_sales', new.track_sales, 'track_inventory', new.track_inventory));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_inventory_catalog_update() from public, anon, authenticated;
create trigger inventory_catalog_update_audit after update of sale_price_cents, unit_cost_cents, track_sales, track_inventory on public.inventory_items
for each row execute function private.audit_inventory_catalog_update();

revoke insert, update on public.inventory_items from authenticated;
grant insert (name, unit, quantity, reorder_level, created_by, category,
  sale_price_cents, unit_cost_cents, track_sales, track_inventory) on public.inventory_items to authenticated;
grant update (sale_price_cents, unit_cost_cents, track_sales, track_inventory) on public.inventory_items to authenticated;

create or replace function public.create_lounge_order(
  p_session_id uuid, p_table_label text, p_items jsonb
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_table text;
  new_order_id uuid;
  computed_total numeric := 0;
  line record;
  product public.inventory_items;
  order_item_id uuid;
begin
  if actor is null or not (select private.has_cashier_role()) then
    raise exception 'Cashier or management access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Add between 1 and 20 catalog items' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(inventory_item_id uuid, quantity numeric)
    where item.inventory_item_id is null or item.quantity is null or item.quantity not between 0.001 and 1000
  ) then raise exception 'Order item details are invalid' using errcode = '22023'; end if;

  for line in select * from jsonb_to_recordset(p_items) as item(inventory_item_id uuid, quantity numeric)
  loop
    select * into product from public.inventory_items
      where id = line.inventory_item_id and is_available and track_sales and sale_price_cents is not null
      for share;
    if not found then raise exception 'A product is unavailable or missing a configured sale price' using errcode = '22023'; end if;
    computed_total := computed_total + round(line.quantity * product.sale_price_cents);
  end loop;
  if computed_total < 0 or computed_total > 9000000000000000000 then
    raise exception 'Order total is outside the supported range' using errcode = '22023';
  end if;

  if p_session_id is not null then
    select s.table_label into target_table from public.lounge_sessions s
      where s.id = p_session_id and s.status = 'active' and s.ends_at > now() for share;
    if target_table is null then raise exception 'Select an active lounge session' using errcode = '22023'; end if;
  else
    target_table := trim(coalesce(p_table_label, ''));
    if char_length(target_table) not between 1 and 32 then
      raise exception 'Enter a table or customer label' using errcode = '22023';
    end if;
  end if;

  insert into public.lounge_orders (session_id, table_label, total_cents, created_by)
    values (p_session_id, target_table, computed_total::bigint, actor) returning id into new_order_id;
  for line in select * from jsonb_to_recordset(p_items) as item(inventory_item_id uuid, quantity numeric)
  loop
    select * into product from public.inventory_items where id = line.inventory_item_id;
    insert into public.lounge_order_items (order_id, inventory_item_id, name, quantity,
      unit_price_cents, deduct_inventory)
    values (new_order_id, product.id, product.name, line.quantity,
      product.sale_price_cents, product.track_inventory)
    returning id into order_item_id;
    insert into public.lounge_order_item_costs (order_item_id, unit_cost_cents)
      values (order_item_id, product.unit_cost_cents);
  end loop;
  insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
    values (actor, 'lounge_order', new_order_id, 'order_created',
      jsonb_build_object('table_label', target_table, 'total_cents', computed_total, 'session_id', p_session_id));
  return new_order_id;
end;
$$;
revoke all on function public.create_lounge_order(uuid, text, jsonb) from public, anon;
grant execute on function public.create_lounge_order(uuid, text, jsonb) to authenticated;

create or replace function private.deduct_paid_order_inventory()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare line record; product public.inventory_items; movement_actor uuid;
begin
  if old.payment_status <> 'paid' and new.payment_status = 'paid' then
    for line in select id, inventory_item_id, quantity, deduct_inventory
      from public.lounge_order_items where order_id = new.id and inventory_item_id is not null and deduct_inventory
    loop
      select * into product from public.inventory_items where id = line.inventory_item_id for update;
      if not found or product.quantity < line.quantity then
        raise exception 'Stock is insufficient to complete this order' using errcode = '22023';
      end if;
      update public.inventory_items set quantity = quantity - line.quantity, updated_at = statement_timestamp()
        where id = product.id;
      movement_actor := coalesce((select auth.uid()), new.created_by);
      insert into public.inventory_movements (item_id, quantity_delta, reason, actor_id)
        values (product.id, -line.quantity, 'Paid sale order ' || new.id::text, movement_actor);
      insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
        values ((select auth.uid()), 'inventory_item', product.id, 'sale_stock_deducted',
          jsonb_build_object('quantity', product.quantity),
          jsonb_build_object('quantity', product.quantity - line.quantity, 'order_id', new.id, 'quantity_sold', line.quantity));
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.deduct_paid_order_inventory() from public, anon, authenticated;
create trigger order_payment_stock_deduction after update of payment_status on public.lounge_orders
for each row execute function private.deduct_paid_order_inventory();

create function public.get_lounge_report(p_from timestamptz, p_to timestamptz)
returns table (
  gross_sales_cents bigint,
  paid_order_count bigint,
  open_order_total_cents bigint,
  open_order_count bigint,
  cancelled_order_count bigint,
  sessions_started bigint,
  sessions_ended bigint,
  stock_movement_count bigint,
  known_cost_cents bigint,
  missing_cost_item_count bigint,
  expense_total_cents bigint,
  recorded_margin_cents bigint
) language plpgsql stable security invoker set search_path = ''
as $$
declare is_financial_admin boolean := (select private.has_admin_role());
begin
  if (select auth.uid()) is null or not (select private.has_cashier_role()) then
    raise exception 'Authorized staff access is required for reports' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'Choose a valid report range no longer than one year' using errcode = '22023';
  end if;

  return query
  with paid_orders as (
    select o.id, o.total_cents from public.lounge_orders o
    where o.paid_at >= p_from and o.paid_at < p_to and o.payment_status = 'paid' and o.status = 'open'
  ), open_orders as (
    select o.id, o.total_cents from public.lounge_orders o
    where o.created_at >= p_from and o.created_at < p_to and o.payment_status = 'unpaid' and o.status = 'open'
  ), cancelled_orders as (
    select o.id from public.lounge_orders o
    where o.cancelled_at >= p_from and o.cancelled_at < p_to and o.status = 'cancelled'
  ), paid_lines as (
    select li.id, li.quantity, c.unit_cost_cents
    from public.lounge_order_items li
    join paid_orders o on o.id = li.order_id
    left join public.lounge_order_item_costs c on c.order_item_id = li.id
  ), totals as (
    select
      coalesce((select sum(o.total_cents) from paid_orders o), 0)::bigint as gross,
      (select count(*) from paid_orders)::bigint as paid_count,
      coalesce((select sum(o.total_cents) from open_orders o), 0)::bigint as open_total,
      (select count(*) from open_orders)::bigint as open_count,
      (select count(*) from cancelled_orders)::bigint as cancelled_count,
      (select count(*) from public.lounge_sessions s where s.started_at >= p_from and s.started_at < p_to)::bigint as started_count,
      (select count(*) from public.lounge_sessions s where s.ended_at >= p_from and s.ended_at < p_to)::bigint as ended_count,
      (select count(*) from public.inventory_movements m where m.created_at >= p_from and m.created_at < p_to)::bigint as movement_count,
      coalesce((select sum(round(l.quantity * l.unit_cost_cents)) from paid_lines l where l.unit_cost_cents is not null), 0)::bigint as known_cost,
      (select count(*) from paid_lines l where l.unit_cost_cents is null)::bigint as missing_cost,
      coalesce((select sum(e.amount_cents) from public.business_expenses e where e.incurred_at >= p_from and e.incurred_at < p_to), 0)::bigint as expenses
  )
  select t.gross, t.paid_count, t.open_total, t.open_count, t.cancelled_count,
    t.started_count, t.ended_count, t.movement_count,
    case when is_financial_admin then t.known_cost else null end,
    case when is_financial_admin then t.missing_cost else null end,
    case when is_financial_admin then t.expenses else null end,
    case when is_financial_admin and t.missing_cost = 0
      then t.gross - t.known_cost - t.expenses else null end
  from totals t;
end;
$$;
revoke all on function public.get_lounge_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_lounge_report(timestamptz, timestamptz) to authenticated;

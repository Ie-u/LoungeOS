-- Catalogue writes use column grants, RLS, and internal triggers. There is no
-- client-callable SECURITY DEFINER endpoint for adding or toggling stock items.

drop function public.audit_staff_admin_action(uuid, text);
drop function public.set_inventory_item_availability(uuid, boolean);
drop function public.create_inventory_item(text, text, numeric, numeric, text);

create policy "Admins create stock catalogue items" on public.inventory_items
for insert to authenticated with check ((select private.has_admin_role()));
create policy "Admins manage stock availability" on public.inventory_items
for update to authenticated using ((select private.has_admin_role()))
with check ((select private.has_admin_role()));

revoke insert, update, delete on public.inventory_items from public, anon, authenticated;
grant insert (name, unit, quantity, reorder_level, created_by, category) on public.inventory_items to authenticated;
grant update (is_available) on public.inventory_items to authenticated;

create or replace function private.guard_inventory_catalog_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.created_by <> (select auth.uid())
    or not (select private.has_admin_role()) then
    raise exception 'Owner or admin access is required to create catalogue items' using errcode = '42501';
  end if;
  new.is_available := true;
  new.created_at := statement_timestamp();
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_inventory_catalog_insert() from public, anon, authenticated;
create trigger inventory_catalog_insert_guard before insert on public.inventory_items
for each row execute function private.guard_inventory_catalog_insert();

create or replace function private.audit_inventory_catalog_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.quantity > 0 then
    insert into public.inventory_movements (item_id, quantity_delta, reason, actor_id)
    values (new.id, new.quantity, 'Initial stock', new.created_by);
  end if;
  insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
  values (new.created_by, 'inventory_item', new.id, 'inventory_item_created',
    jsonb_build_object('name', new.name, 'unit', new.unit, 'quantity', new.quantity,
      'reorder_level', new.reorder_level, 'category', new.category));
  return new;
end;
$$;
revoke all on function private.audit_inventory_catalog_insert() from public, anon, authenticated;
create trigger inventory_catalog_insert_audit after insert on public.inventory_items
for each row execute function private.audit_inventory_catalog_insert();

create or replace function private.audit_inventory_availability_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.has_admin_role()) then
    raise exception 'Owner or admin access is required to change catalogue availability' using errcode = '42501';
  end if;
  new.updated_at := statement_timestamp();
  if old.is_available is distinct from new.is_available then
    if new.category = 'flavor' and not new.is_available then
      update public.flavor_tasks set status = 'cancelled'
        where inventory_item_id = new.id and status in ('queued', 'preparing');
    end if;
    insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
    values ((select auth.uid()), 'inventory_item', new.id, 'inventory_availability_changed',
      jsonb_build_object('is_available', old.is_available),
      jsonb_build_object('is_available', new.is_available, 'category', new.category));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_inventory_availability_change() from public, anon, authenticated;
create trigger inventory_availability_audit before update of is_available on public.inventory_items
for each row execute function private.audit_inventory_availability_change();

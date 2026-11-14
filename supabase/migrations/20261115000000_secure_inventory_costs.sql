-- Move cost fetching from a service-role page component to a secure RPC.
create or replace function public.get_admin_inventory_costs()
returns table (id uuid, unit_cost_cents bigint)
language plpgsql security definer set search_path = ''
as $$
begin
  if not (select private.has_admin_role()) then
    raise exception 'Owner or admin access is required' using errcode = '42501';
  end if;
  return query select i.id, i.unit_cost_cents from public.inventory_items i;
end;
$$;
revoke all on function public.get_admin_inventory_costs() from public, anon;
grant execute on function public.get_admin_inventory_costs() to authenticated;

create function public.get_low_stock_count()
returns bigint language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not (select private.has_cashier_role()) and not (select private.has_flavor_role()) then
    raise exception 'Inventory access is required' using errcode='42501';
  end if;
  return (select count(*) from public.inventory_items where quantity <= reorder_level);
end;
$$;
revoke all on function public.get_low_stock_count() from public, anon;
grant execute on function public.get_low_stock_count() to authenticated;

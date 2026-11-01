-- Product costs are private business information. Keep ordinary inventory
-- selection usable while exposing cost values only through an admin-filtered view.
revoke select on public.inventory_items from authenticated;
grant select (id, name, unit, quantity, reorder_level, created_by, updated_at,
  category, is_available, sale_price_cents, track_sales, track_inventory)
  on public.inventory_items to authenticated;

create view public.inventory_admin_costs with (security_barrier = true) as
  select id, unit_cost_cents from public.inventory_items
  where (select private.has_admin_role());
revoke all on public.inventory_admin_costs from public, anon;
grant select on public.inventory_admin_costs to authenticated;

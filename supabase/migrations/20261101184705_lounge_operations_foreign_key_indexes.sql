create index inventory_items_created_by_idx on public.inventory_items (created_by);
create index inventory_movements_actor_id_idx on public.inventory_movements (actor_id);
create index lounge_orders_created_by_idx on public.lounge_orders (created_by);
create index lounge_orders_paid_by_idx on public.lounge_orders (paid_by) where paid_by is not null;
create index lounge_orders_cancelled_by_idx on public.lounge_orders (cancelled_by) where cancelled_by is not null;

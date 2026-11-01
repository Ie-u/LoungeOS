create extension if not exists pg_cron with schema pg_catalog;

create table public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  event_type text not null check (event_type in ('session_ending_soon','session_overdue','low_stock')),
  entity_type text not null check (entity_type in ('lounge_session','inventory_item')),
  entity_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 300),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((event_type = 'low_stock' and entity_type = 'inventory_item')
      or (event_type <> 'low_stock' and entity_type = 'lounge_session'))
);
create index staff_notifications_unread_idx on public.staff_notifications(staff_id, created_at desc) where read_at is null;
create index staff_notifications_dedupe_idx on public.staff_notifications(staff_id, event_type, entity_id, created_at desc);
alter table public.staff_notifications enable row level security;
create policy "Staff read own notifications" on public.staff_notifications
for select to authenticated using (staff_id = (select auth.uid()) and (select private.has_active_staff()));
create policy "Staff mark own notifications read" on public.staff_notifications
for update to authenticated using (staff_id = (select auth.uid()) and (select private.has_active_staff()))
with check (staff_id = (select auth.uid()) and (select private.has_active_staff()));
revoke all on public.staff_notifications from public, anon, authenticated;
grant select on public.staff_notifications to authenticated;
grant update (read_at) on public.staff_notifications to authenticated;

create function private.guard_notification_read()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if row(new.id,new.staff_id,new.event_type,new.entity_type,new.entity_id,new.title,new.message,new.created_at)
    is distinct from row(old.id,old.staff_id,old.event_type,old.entity_type,old.entity_id,old.title,old.message,old.created_at)
    or new.read_at is null then
    raise exception 'Notifications are immutable; set the read timestamp only' using errcode='42501';
  end if;
  new.read_at := coalesce(old.read_at,statement_timestamp());
  return new;
end;
$$;
revoke all on function private.guard_notification_read() from public, anon, authenticated;
create trigger staff_notification_read_guard before update on public.staff_notifications
for each row execute function private.guard_notification_read();

create function private.emit_operations_notifications()
returns void language plpgsql security definer set search_path = ''
as $$
declare current_time timestamptz := statement_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(270101,1);

  insert into public.staff_notifications(staff_id,event_type,entity_type,entity_id,title,message)
  select recipients.user_id,'session_ending_soon','lounge_session',s.id,'Session ending soon',
    'Table ' || s.table_label || ' · ' || s.option_name || ' is scheduled to end at ' || to_char(s.ends_at at time zone 'Africa/Nairobi','HH24:MI') || '.'
  from public.lounge_sessions s
  join public.business_settings b on b.singleton
  join public.staff_profiles recipients on recipients.is_active
    and (recipients.role in ('owner','admin','manager','cashier') or recipients.user_id=s.assigned_attendant)
  where s.status='active' and s.ends_at > current_time
    and s.ends_at <= current_time + make_interval(mins => coalesce(b.session_alert_minutes,10))
    and not exists(select 1 from public.staff_notifications n where n.staff_id=recipients.user_id
      and n.event_type='session_ending_soon' and n.entity_id=s.id);

  insert into public.staff_notifications(staff_id,event_type,entity_type,entity_id,title,message)
  select recipients.user_id,'session_overdue','lounge_session',s.id,'Session is overdue',
    'Table ' || s.table_label || ' · ' || s.option_name || ' passed its scheduled end time.'
  from public.lounge_sessions s
  join public.staff_profiles recipients on recipients.is_active
    and (recipients.role in ('owner','admin','manager','cashier') or recipients.user_id=s.assigned_attendant)
  where s.status='active' and s.ends_at <= current_time
    and not exists(select 1 from public.staff_notifications n where n.staff_id=recipients.user_id
      and n.event_type='session_overdue' and n.entity_id=s.id);

  insert into public.staff_notifications(staff_id,event_type,entity_type,entity_id,title,message)
  select recipients.user_id,'low_stock','inventory_item',i.id,'Inventory at reorder level',
    i.name || ' has ' || i.quantity::text || ' ' || i.unit || ' remaining (reorder at ' || i.reorder_level::text || ').'
  from public.inventory_items i
  join public.business_settings b on b.singleton and b.low_stock_alert_enabled
  join public.staff_profiles recipients on recipients.is_active and recipients.role in ('owner','admin','manager','cashier')
  where i.is_available and i.quantity <= i.reorder_level
    and not exists(select 1 from public.staff_notifications n where n.staff_id=recipients.user_id
      and n.event_type='low_stock' and n.entity_id=i.id and n.created_at > current_time - interval '8 hours');
end;
$$;
revoke all on function private.emit_operations_notifications() from public, anon, authenticated;

select cron.schedule('loungeos-operations-notifications','* * * * *','select private.emit_operations_notifications()');

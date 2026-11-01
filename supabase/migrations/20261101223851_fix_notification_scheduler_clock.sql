create or replace function private.emit_operations_notifications()
returns void language plpgsql security definer set search_path = ''
as $$
declare v_now timestamptz := statement_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(270101,1);

  insert into public.staff_notifications(staff_id,event_type,entity_type,entity_id,title,message)
  select recipients.user_id,'session_ending_soon','lounge_session',s.id,'Session ending soon',
    'Table ' || s.table_label || ' · ' || s.option_name || ' is scheduled to end at ' || to_char(s.ends_at at time zone 'Africa/Nairobi','HH24:MI') || '.'
  from public.lounge_sessions s
  join public.business_settings b on b.singleton
  join public.staff_profiles recipients on recipients.is_active
    and (recipients.role in ('owner','admin','manager','cashier') or recipients.user_id=s.assigned_attendant)
  where s.status='active' and s.ends_at > v_now
    and s.ends_at <= v_now + make_interval(mins => coalesce(b.session_alert_minutes,10))
    and not exists(select 1 from public.staff_notifications n where n.staff_id=recipients.user_id
      and n.event_type='session_ending_soon' and n.entity_id=s.id);

  insert into public.staff_notifications(staff_id,event_type,entity_type,entity_id,title,message)
  select recipients.user_id,'session_overdue','lounge_session',s.id,'Session is overdue',
    'Table ' || s.table_label || ' · ' || s.option_name || ' passed its scheduled end time.'
  from public.lounge_sessions s
  join public.staff_profiles recipients on recipients.is_active
    and (recipients.role in ('owner','admin','manager','cashier') or recipients.user_id=s.assigned_attendant)
  where s.status='active' and s.ends_at <= v_now
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
      and n.event_type='low_stock' and n.entity_id=i.id and n.created_at > v_now - interval '8 hours');
end;
$$;
revoke all on function private.emit_operations_notifications() from public, anon, authenticated;

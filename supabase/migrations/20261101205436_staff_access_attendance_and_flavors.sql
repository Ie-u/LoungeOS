-- Add least-privilege staff roles, append-only attendance records, and a focused
-- flavor workflow using the existing inventory table as its stock source.

drop trigger if exists staff_role_audit on public.staff_profiles;
drop policy if exists "Staff can view own profile or management can view all" on public.staff_profiles;
alter table public.staff_profiles alter column role drop default;
alter table public.staff_profiles alter column role type text using role::text;
alter table public.staff_profiles alter column role set default 'attendant';
alter table public.staff_profiles
  add constraint staff_profiles_role_check
  check (role in ('owner', 'admin', 'manager', 'cashier', 'attendant', 'flavor_specialist'));

alter table public.staff_profiles
  add column is_active boolean not null default true,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.staff_profiles(user_id);
create policy "Active staff can view own profile or managers can view roster" on public.staff_profiles
for select to authenticated using (user_id = (select auth.uid()) or (select private.has_management_role()));

create or replace function public.create_staff_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.staff_profiles (user_id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1), 'Staff member'));
  return new;
end;
$$;

alter table public.inventory_items
  add column category text not null default 'supply'
    check (category in ('supply', 'flavor', 'equipment', 'other')),
  add column is_available boolean not null default true;

create table public.business_settings (
  singleton boolean primary key default true check (singleton),
  business_name text check (business_name is null or char_length(business_name) between 1 and 120),
  venue_latitude double precision check (venue_latitude is null or venue_latitude between -90 and 90),
  venue_longitude double precision check (venue_longitude is null or venue_longitude between -180 and 180),
  geofence_radius_m integer check (geofence_radius_m is null or geofence_radius_m between 10 and 5000),
  max_location_accuracy_m integer check (max_location_accuracy_m is null or max_location_accuracy_m between 5 and 1000),
  session_alert_minutes integer check (session_alert_minutes is null or session_alert_minutes between 1 and 60),
  low_stock_alert_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_profiles(user_id),
  check ((venue_latitude is null and venue_longitude is null) or (venue_latitude is not null and venue_longitude is not null))
);
insert into public.business_settings (singleton) values (true);

create or replace function private.touch_business_settings()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.singleton := true;
  new.updated_at := statement_timestamp();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;
revoke all on function private.touch_business_settings() from public, anon, authenticated;
create trigger business_settings_touch before update on public.business_settings
for each row execute function private.touch_business_settings();
revoke update on public.business_settings from authenticated;
grant update (business_name, venue_latitude, venue_longitude, geofence_radius_m,
  max_location_accuracy_m, session_alert_minutes, low_stock_alert_enabled) on public.business_settings to authenticated;

create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(user_id) on delete restrict,
  event_type text not null check (event_type in ('check_in', 'check_out')),
  recorded_at timestamptz not null default statement_timestamp(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m between 0 and 10000),
  distance_m double precision not null check (distance_m >= 0),
  created_at timestamptz not null default statement_timestamp()
);
create index staff_attendance_staff_time_idx on public.staff_attendance (staff_id, recorded_at desc);

create table public.attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(user_id) on delete restrict,
  event_type text not null check (event_type in ('check_in', 'check_out')),
  requested_at timestamptz not null,
  reason text not null check (char_length(trim(reason)) between 8 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references public.staff_profiles(user_id),
  reviewed_by uuid references public.staff_profiles(user_id),
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  check ((status = 'pending' and reviewed_by is null and reviewed_at is null and review_reason is null)
    or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null and char_length(trim(coalesce(review_reason, ''))) >= 8))
);
create index attendance_exceptions_status_time_idx on public.attendance_exceptions (status, created_at desc);

create table public.flavor_tasks (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  session_id uuid references public.lounge_sessions(id) on delete set null,
  assigned_to uuid not null references public.staff_profiles(user_id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'preparing', 'ready', 'cancelled')),
  quantity_used numeric(12,3) not null default 0 check (quantity_used >= 0),
  preparation_note text check (preparation_note is null or char_length(preparation_note) <= 500),
  created_by uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now(),
  completed_by uuid references public.staff_profiles(user_id),
  completed_at timestamptz,
  check ((status = 'ready' and completed_by is not null and completed_at is not null)
    or (status <> 'ready' and completed_by is null and completed_at is null))
);
create index flavor_tasks_assigned_status_idx on public.flavor_tasks (assigned_to, status, created_at desc);
create index flavor_tasks_session_idx on public.flavor_tasks (session_id) where session_id is not null;

create or replace function private.has_active_staff()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and is_active);
$$;

create or replace function private.has_owner_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and is_active and role = 'owner');
$$;

create or replace function private.has_admin_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and is_active and role in ('owner', 'admin'));
$$;

create or replace function private.has_management_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and is_active and role in ('owner', 'admin', 'manager'));
$$;

create or replace function private.has_cashier_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and is_active and role in ('owner', 'admin', 'manager', 'cashier'));
$$;

create or replace function private.has_flavor_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and is_active and role = 'flavor_specialist');
$$;

revoke all on function private.has_active_staff() from public, anon;
revoke all on function private.has_owner_role() from public, anon;
revoke all on function private.has_admin_role() from public, anon;
revoke all on function private.has_flavor_role() from public, anon;
grant execute on function private.has_active_staff(), private.has_owner_role(), private.has_admin_role(), private.has_flavor_role() to authenticated;
revoke all on function private.has_management_role(), private.has_cashier_role() from public, anon;
grant execute on function private.has_management_role(), private.has_cashier_role() to authenticated;

create or replace function private.guard_staff_profile_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare actor_role text;
begin
  if tg_op = 'INSERT' then
    select role into actor_role from public.staff_profiles
      where user_id = (select auth.uid()) and is_active;
    if actor_role is null or new.user_id = (select auth.uid()) then
      raise exception 'An active manager must invite another staff account' using errcode = '42501';
    end if;
    if actor_role <> 'owner' and new.role in ('owner', 'admin') then
      raise exception 'Only the owner can assign owner or admin access' using errcode = '42501';
    end if;
    if actor_role not in ('owner', 'admin', 'manager') then
      raise exception 'Staff management access is required' using errcode = '42501';
    end if;
    new.is_active := true;
    new.deactivated_at := null;
    new.deactivated_by := null;
    new.updated_at := statement_timestamp();
    return new;
  end if;

  select role into actor_role from public.staff_profiles
    where user_id = (select auth.uid()) and is_active;
  if actor_role is null or new.user_id = (select auth.uid()) then
    raise exception 'You cannot change your own protected staff access' using errcode = '42501';
  end if;
  if actor_role = 'manager' and (old.role in ('owner', 'admin') or new.role in ('owner', 'admin')) then
    raise exception 'Managers cannot change owner or admin access' using errcode = '42501';
  end if;
  if actor_role = 'admin' and (old.role = 'owner' or new.role = 'owner') then
    raise exception 'Only the owner can change owner access' using errcode = '42501';
  end if;
  if actor_role not in ('owner', 'admin', 'manager') then
    raise exception 'Staff management access is required' using errcode = '42501';
  end if;
  if old.is_active is distinct from new.is_active then
    new.deactivated_at := case when new.is_active then null else statement_timestamp() end;
    new.deactivated_by := case when new.is_active then null else (select auth.uid()) end;
  else
    new.deactivated_at := old.deactivated_at;
    new.deactivated_by := old.deactivated_by;
  end if;
  new.created_at := old.created_at;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_staff_profile_changes() from public, anon, authenticated;
create trigger staff_profile_access_guard before insert or update on public.staff_profiles
for each row execute function private.guard_staff_profile_changes();

create or replace function private.audit_staff_access_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
      values ((select auth.uid()), 'staff_profile', new.user_id, 'staff_invited', jsonb_build_object('role', new.role));
    end if;
  elsif old.role is distinct from new.role then
    insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
    values ((select auth.uid()), 'staff_profile', new.user_id, 'staff_role_changed',
      jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
  elsif old.is_active is distinct from new.is_active then
    insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
    values ((select auth.uid()), 'staff_profile', new.user_id,
      case when new.is_active then 'staff_activated' else 'staff_deactivated' end,
      jsonb_build_object('is_active', old.is_active), jsonb_build_object('is_active', new.is_active));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_staff_access_changes() from public, anon, authenticated;
create trigger staff_access_audit after insert or update of role, is_active on public.staff_profiles
for each row execute function private.audit_staff_access_changes();

create function public.audit_staff_admin_action(p_user_id uuid, p_action text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.has_management_role())
    or p_action not in ('staff_invitation_sent', 'password_recovery_sent')
    or not exists (select 1 from public.staff_profiles where user_id = p_user_id) then
    raise exception 'Staff management access is required for this audit event' using errcode = '42501';
  end if;
  insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
  values ((select auth.uid()), 'staff_profile', p_user_id, p_action, '{}'::jsonb);
end;
$$;
revoke all on function public.audit_staff_admin_action(uuid, text) from public, anon;
grant execute on function public.audit_staff_admin_action(uuid, text) to authenticated;

drop policy if exists "Management can add staff" on public.staff_profiles;
drop policy if exists "Management can update staff roles" on public.staff_profiles;
drop policy if exists "Management can remove staff" on public.staff_profiles;
create policy "Managers can add lower privilege staff" on public.staff_profiles
for insert to authenticated with check ((select private.has_management_role()));
create policy "Managers can update other staff" on public.staff_profiles
for update to authenticated
using ((select private.has_management_role()) and user_id <> (select auth.uid())
  and ((select private.has_owner_role()) or role not in ('owner', 'admin')))
with check ((select private.has_management_role()) and user_id <> (select auth.uid())
  and ((select private.has_owner_role()) or role not in ('owner', 'admin')));

revoke update, delete on public.staff_profiles from authenticated;
grant update (display_name, role, is_active) on public.staff_profiles to authenticated;

create policy "Active staff read business settings" on public.business_settings
for select to authenticated using ((select private.has_active_staff()));
create policy "Owners and admins update business settings" on public.business_settings
for update to authenticated using ((select private.has_admin_role()))
with check ((select private.has_admin_role()));
alter table public.business_settings enable row level security;
revoke all on public.business_settings from public, anon, authenticated;
grant select on public.business_settings to authenticated;
grant update (business_name, venue_latitude, venue_longitude, geofence_radius_m,
  max_location_accuracy_m, session_alert_minutes, low_stock_alert_enabled) on public.business_settings to authenticated;

create or replace function private.guard_attendance_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare settings public.business_settings; previous_type text; distance double precision; lat1 double precision; lat2 double precision;
begin
  if (select auth.uid()) is null or new.staff_id <> (select auth.uid()) then
    raise exception 'Attendance must be recorded for the signed-in staff member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff_profiles where user_id = new.staff_id and is_active) then
    raise exception 'Active staff access is required' using errcode = '42501';
  end if;
  select * into settings from public.business_settings where singleton;
  if settings.venue_latitude is null or settings.geofence_radius_m is null or settings.max_location_accuracy_m is null then
    raise exception 'The owner must configure venue coordinates, radius, and accuracy limits before attendance is enabled' using errcode = '55000';
  end if;
  if new.accuracy_m > settings.max_location_accuracy_m then
    raise exception 'Location accuracy is too low; move to an open area and try again or request a manager review' using errcode = '22023';
  end if;
  lat1 := radians(new.latitude);
  lat2 := radians(settings.venue_latitude);
  distance := 6371000 * 2 * asin(sqrt(
    power(sin((lat2 - lat1) / 2), 2) +
    cos(lat1) * cos(lat2) * power(sin((radians(settings.venue_longitude) - radians(new.longitude)) / 2), 2)
  ));
  if distance + new.accuracy_m > settings.geofence_radius_m then
    raise exception 'The reported location is outside the configured premises radius or too close to its boundary; request a manager review if this is a GPS error' using errcode = '22023';
  end if;
  select event_type into previous_type from public.staff_attendance
    where staff_id = new.staff_id order by recorded_at desc, id desc limit 1;
  if (new.event_type = 'check_in' and previous_type = 'check_in')
    or (new.event_type = 'check_out' and previous_type is distinct from 'check_in') then
    raise exception 'Check-in and check-out must alternate; request a manager review for a correction' using errcode = '40001';
  end if;
  new.distance_m := distance;
  new.recorded_at := statement_timestamp();
  new.created_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_attendance_event() from public, anon, authenticated;
create trigger attendance_location_guard before insert on public.staff_attendance
for each row execute function private.guard_attendance_event();

create or replace function private.audit_attendance_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
  values (new.staff_id, 'staff_attendance', new.id, new.event_type,
    jsonb_build_object('recorded_at', new.recorded_at, 'accuracy_m', new.accuracy_m, 'distance_m', new.distance_m));
  return new;
end;
$$;
revoke all on function private.audit_attendance_event() from public, anon, authenticated;
create trigger attendance_event_audit after insert on public.staff_attendance
for each row execute function private.audit_attendance_event();

alter table public.staff_attendance enable row level security;
create policy "Staff read own attendance and managers read all" on public.staff_attendance
for select to authenticated using (staff_id = (select auth.uid()) or (select private.has_management_role()));
create policy "Active staff append own attendance" on public.staff_attendance
for insert to authenticated with check (staff_id = (select auth.uid()) and (select private.has_active_staff()));
revoke all on public.staff_attendance from public, anon, authenticated;
grant select on public.staff_attendance to authenticated;
grant insert (staff_id, event_type, latitude, longitude, accuracy_m, distance_m) on public.staff_attendance to authenticated;

alter table public.attendance_exceptions enable row level security;
create policy "Staff read own attendance exceptions and managers read all" on public.attendance_exceptions
for select to authenticated using (staff_id = (select auth.uid()) or (select private.has_management_role()));
create policy "Staff request own attendance review" on public.attendance_exceptions
for insert to authenticated with check (staff_id = (select auth.uid()) and requested_by = (select auth.uid()) and status = 'pending');
create policy "Managers review attendance exceptions" on public.attendance_exceptions
for update to authenticated using ((select private.has_management_role()))
with check ((select private.has_management_role()) and reviewed_by = (select auth.uid()));
revoke all on public.attendance_exceptions from public, anon, authenticated;
grant select, insert on public.attendance_exceptions to authenticated;
grant update (status, reviewed_by, reviewed_at, review_reason) on public.attendance_exceptions to authenticated;

create or replace function private.guard_attendance_exception()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.staff_id <> (select auth.uid()) or new.requested_by <> (select auth.uid()) then
      raise exception 'Staff can only request review for their own attendance' using errcode = '42501';
    end if;
    new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.review_reason := null;
    new.created_at := statement_timestamp();
    return new;
  end if;
  if old.status <> 'pending' or new.status not in ('approved', 'rejected')
    or new.reviewed_by <> (select auth.uid()) or char_length(trim(coalesce(new.review_reason, ''))) < 8 then
    raise exception 'A pending request needs one manager decision and an explanation' using errcode = '22023';
  end if;
  new.staff_id := old.staff_id; new.event_type := old.event_type; new.requested_at := old.requested_at;
  new.reason := old.reason; new.requested_by := old.requested_by; new.created_at := old.created_at;
  new.reviewed_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_attendance_exception() from public, anon, authenticated;
create trigger attendance_exception_guard before insert or update on public.attendance_exceptions
for each row execute function private.guard_attendance_exception();

create or replace function private.audit_attendance_exception()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
  values ((select auth.uid()), 'attendance_exception', new.id,
    case when tg_op = 'INSERT' then 'attendance_review_requested' else 'attendance_review_resolved' end,
    case when tg_op = 'INSERT' then null else jsonb_build_object('status', old.status) end,
    jsonb_build_object('staff_id', new.staff_id, 'event_type', new.event_type, 'status', new.status,
      'reason', case when tg_op = 'INSERT' then new.reason else new.review_reason end));
  return new;
end;
$$;
revoke all on function private.audit_attendance_exception() from public, anon, authenticated;
create trigger attendance_exception_audit after insert or update on public.attendance_exceptions
for each row execute function private.audit_attendance_exception();

alter table public.flavor_tasks enable row level security;
create policy "Managers and assigned flavor specialists read tasks" on public.flavor_tasks
for select to authenticated using ((select private.has_management_role()) or
  (assigned_to = (select auth.uid()) and (select private.has_flavor_role())));
create policy "Managers assign flavor specialists" on public.flavor_tasks
for insert to authenticated with check ((select private.has_management_role()) and created_by = (select auth.uid()));
create policy "Managers and assignees update flavor tasks" on public.flavor_tasks
for update to authenticated using ((select private.has_management_role()) or
  (assigned_to = (select auth.uid()) and (select private.has_flavor_role())))
with check ((select private.has_management_role()) or
  (assigned_to = (select auth.uid()) and (select private.has_flavor_role())));
revoke all on public.flavor_tasks from public, anon;
grant select, insert, update on public.flavor_tasks to authenticated;

create or replace function private.guard_flavor_task()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare item public.inventory_items;
begin
  if tg_op = 'INSERT' then
    if new.created_by <> (select auth.uid()) or not (select private.has_management_role())
      or not exists (select 1 from public.staff_profiles s where s.user_id = new.assigned_to and s.is_active and s.role = 'flavor_specialist')
      or not exists (select 1 from public.inventory_items i where i.id = new.inventory_item_id and i.category = 'flavor' and i.is_available) then
      raise exception 'Only managers can assign an available flavor to an active flavor specialist' using errcode = '42501';
    end if;
    new.status := 'queued'; new.completed_by := null; new.completed_at := null;
    return new;
  end if;
  if old.status in ('ready', 'cancelled') then
    raise exception 'Completed or cancelled flavor tasks cannot be edited' using errcode = '40001';
  end if;
  if not (select private.has_management_role()) then
    if old.assigned_to <> (select auth.uid()) or old.status not in ('queued', 'preparing')
      or new.inventory_item_id <> old.inventory_item_id or new.session_id is distinct from old.session_id
      or new.assigned_to <> old.assigned_to or new.created_by <> old.created_by
      or new.created_at <> old.created_at or new.status not in ('preparing', 'ready') then
      raise exception 'Flavor specialists may only update their assigned preparation status' using errcode = '42501';
    end if;
    new.completed_by := case when new.status = 'ready' then (select auth.uid()) else null end;
    new.completed_at := case when new.status = 'ready' then statement_timestamp() else null end;
  else
    if not exists (select 1 from public.staff_profiles s where s.user_id = new.assigned_to and s.is_active and s.role = 'flavor_specialist')
      or not exists (select 1 from public.inventory_items i where i.id = new.inventory_item_id and i.category = 'flavor' and i.is_available) then
      raise exception 'Tasks must stay assigned to an active flavor specialist and an available flavor' using errcode = '22023';
    end if;
    if new.completed_by is distinct from old.completed_by or new.completed_at is distinct from old.completed_at then
      raise exception 'Completion fields are system managed' using errcode = '42501';
    end if;
    if old.status <> 'ready' and new.status = 'ready' then
      new.completed_by := (select auth.uid());
      new.completed_at := statement_timestamp();
    elsif new.status <> 'ready' then
      new.completed_by := null; new.completed_at := null;
    end if;
  end if;
  if old.status <> 'ready' and new.status = 'ready' and new.quantity_used > 0 then
    select * into item from public.inventory_items where id = new.inventory_item_id for update;
    if item.quantity < new.quantity_used then
      raise exception 'Flavor stock is too low to record this usage' using errcode = '22023';
    end if;
    update public.inventory_items set quantity = quantity - new.quantity_used, updated_at = statement_timestamp()
      where id = item.id;
    insert into public.inventory_movements (item_id, quantity_delta, reason, actor_id)
      values (item.id, -new.quantity_used, 'Flavor preparation task ' || new.id::text, (select auth.uid()));
  end if;
  return new;
end;
$$;
revoke all on function private.guard_flavor_task() from public, anon, authenticated;
create trigger flavor_task_guard before insert or update on public.flavor_tasks
for each row execute function private.guard_flavor_task();

create or replace function private.audit_flavor_task()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
  values ((select auth.uid()), 'flavor_task', new.id,
    case when tg_op = 'INSERT' then 'flavor_task_assigned' else 'flavor_task_updated' end,
    case when tg_op = 'INSERT' then null else jsonb_build_object('status', old.status) end,
    jsonb_build_object('status', new.status, 'assigned_to', new.assigned_to,
      'inventory_item_id', new.inventory_item_id, 'session_id', new.session_id, 'quantity_used', new.quantity_used));
  return new;
end;
$$;
revoke all on function private.audit_flavor_task() from public, anon, authenticated;
create trigger flavor_task_audit after insert or update on public.flavor_tasks
for each row execute function private.audit_flavor_task();

revoke all on public.flavor_tasks from authenticated;
grant select, insert, update on public.flavor_tasks to authenticated;

drop policy if exists "Management can add shisha options" on public.shisha_options;
drop policy if exists "Management can update shisha options" on public.shisha_options;
drop policy if exists "Management can remove shisha options" on public.shisha_options;
create policy "Admins manage shisha options" on public.shisha_options
for all to authenticated using ((select private.has_admin_role()))
with check ((select private.has_admin_role()));

drop policy if exists "Cashiers and managers can view inventory" on public.inventory_items;
create policy "Cashiers and managers can view inventory" on public.inventory_items
for select to authenticated using ((select private.has_cashier_role()));
create policy "Flavor specialists view available flavor stock" on public.inventory_items
for select to authenticated using (category = 'flavor' and (select private.has_flavor_role()));
create policy "Flavor specialists view flavor movements" on public.inventory_movements
for select to authenticated using (exists (select 1 from public.inventory_items i
  where i.id = item_id and i.category = 'flavor') and (select private.has_flavor_role()));

drop policy if exists "Cashiers and managers can view sessions" on public.lounge_sessions;
create policy "Staff view permitted sessions" on public.lounge_sessions
for select to authenticated using ((select private.has_active_staff()) and ((select private.has_cashier_role())
  or assigned_attendant = (select auth.uid())
  or exists (select 1 from public.flavor_tasks t where t.session_id = lounge_sessions.id
    and t.assigned_to = (select auth.uid()) and (select private.has_flavor_role()))));

drop policy if exists "Staff can view shisha options" on public.shisha_options;
create policy "Active staff can view shisha options" on public.shisha_options
for select to authenticated using ((select private.has_active_staff()));

drop function public.create_inventory_item(text, text, numeric, numeric);
create function public.create_inventory_item(
  p_name text, p_unit text, p_initial_quantity numeric, p_reorder_level numeric, p_category text
) returns public.inventory_items language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); item public.inventory_items;
begin
  if actor is null or not (select private.has_admin_role()) then
    raise exception 'Owner or admin access is required to create a stock catalogue item' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 100
     or char_length(trim(coalesce(p_unit, ''))) not between 1 and 32
     or p_initial_quantity is null or p_initial_quantity < 0
     or p_reorder_level is null or p_reorder_level < 0
     or p_category not in ('supply', 'flavor', 'equipment', 'other') then
    raise exception 'Inventory item details are invalid' using errcode = '22023';
  end if;
  insert into public.inventory_items (name, unit, quantity, reorder_level, created_by, category)
  values (trim(p_name), trim(p_unit), p_initial_quantity, p_reorder_level, actor, p_category)
  returning * into item;
  if p_initial_quantity > 0 then
    insert into public.inventory_movements (item_id, quantity_delta, reason, actor_id)
    values (item.id, p_initial_quantity, 'Initial stock', actor);
  end if;
  insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
  values (actor, 'inventory_item', item.id, 'inventory_item_created',
    jsonb_build_object('name', item.name, 'unit', item.unit, 'quantity', item.quantity,
      'reorder_level', item.reorder_level, 'category', item.category));
  return item;
end;
$$;
revoke all on function public.create_inventory_item(text, text, numeric, numeric, text) from public, anon;
grant execute on function public.create_inventory_item(text, text, numeric, numeric, text) to authenticated;

create function public.set_inventory_item_availability(p_item_id uuid, p_is_available boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); item public.inventory_items; was_available boolean;
begin
  if actor is null or not (select private.has_admin_role()) then
    raise exception 'Owner or admin access is required to change catalogue availability' using errcode = '42501';
  end if;
  select is_available into was_available from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Inventory item not found' using errcode = 'P0002'; end if;
  update public.inventory_items set is_available = p_is_available, updated_at = statement_timestamp()
    where id = p_item_id returning * into item;
  if item.category = 'flavor' and not item.is_available then
    update public.flavor_tasks set status = 'cancelled'
      where inventory_item_id = item.id and status in ('queued', 'preparing');
  end if;
  insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
    values (actor, 'inventory_item', item.id, 'inventory_availability_changed',
      jsonb_build_object('is_available', was_available),
      jsonb_build_object('is_available', item.is_available, 'category', item.category));
end;
$$;
revoke all on function public.set_inventory_item_availability(uuid, boolean) from public, anon;
grant execute on function public.set_inventory_item_availability(uuid, boolean) to authenticated;

grant usage on schema public to authenticated;
grant select on public.business_settings, public.staff_attendance, public.attendance_exceptions, public.flavor_tasks to authenticated;
grant insert on public.attendance_exceptions to authenticated;
grant update (status, reviewed_by, reviewed_at, review_reason) on public.attendance_exceptions to authenticated;
grant select on public.inventory_items, public.inventory_movements to authenticated;

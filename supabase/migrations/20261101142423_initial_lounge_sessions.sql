create type public.staff_role as enum ('owner', 'admin', 'cashier', 'attendant');
create type public.session_lifecycle as enum ('active', 'ended');

create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Staff member' check (char_length(display_name) between 1 and 100),
  role public.staff_role not null default 'attendant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shisha_options (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  duration_minutes integer not null check (duration_minutes between 15 and 360),
  price_cents integer not null default 0 check (price_cents >= 0),
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.lounge_sessions (
  id uuid primary key default gen_random_uuid(),
  table_label text not null check (char_length(table_label) between 1 and 32),
  option_id uuid not null references public.shisha_options(id),
  option_name text not null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status public.session_lifecycle not null default 'active',
  started_by uuid not null references public.staff_profiles(user_id),
  assigned_attendant uuid references public.staff_profiles(user_id),
  ended_at timestamptz,
  ended_by uuid references public.staff_profiles(user_id),
  created_at timestamptz not null default now(),
  check (ends_at > started_at),
  check ((status = 'active' and ended_at is null and ended_by is null) or
         (status = 'ended' and ended_at is not null and ended_by is not null))
);
create index lounge_sessions_active_ends_at_idx on public.lounge_sessions (ends_at) where status = 'active';
create index lounge_sessions_attendant_idx on public.lounge_sessions (assigned_attendant) where status = 'active';

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.staff_profiles(user_id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);

create function public.has_management_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and role in ('owner', 'admin')
  );
$$;
revoke all on function public.has_management_role() from public;
grant execute on function public.has_management_role() to authenticated;

create function public.has_cashier_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and role in ('owner', 'admin', 'cashier')
  );
$$;
revoke all on function public.has_cashier_role() from public;
grant execute on function public.has_cashier_role() to authenticated;

create function public.create_staff_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.staff_profiles (user_id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1), 'Staff member'));
  return new;
end;
$$;
create trigger auth_user_created_profile after insert on auth.users
for each row execute function public.create_staff_profile();

create function public.write_session_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  event_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
    values (new.started_by, 'lounge_session', new.id, 'session_started',
      jsonb_build_object('table_label', new.table_label, 'option_name', new.option_name, 'started_at', new.started_at, 'ends_at', new.ends_at, 'assigned_attendant', new.assigned_attendant));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.ends_at is distinct from new.ends_at and new.status = 'active' then
      event_action := 'session_extended';
    elsif old.status = 'active' and new.status = 'ended' then
      event_action := 'session_ended';
    else
      return new;
    end if;
    insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
    values ((select auth.uid()), 'lounge_session', new.id, event_action,
      jsonb_build_object('status', old.status, 'ends_at', old.ends_at),
      jsonb_build_object('status', new.status, 'ends_at', new.ends_at, 'ended_at', new.ended_at));
    return new;
  end if;
  return new;
end;
$$;
create trigger lounge_session_audit after insert or update on public.lounge_sessions
for each row execute function public.write_session_audit();

create function public.guard_session_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if row(new.table_label, new.option_id, new.option_name, new.started_at, new.started_by, new.assigned_attendant, new.created_at)
     is distinct from
     row(old.table_label, old.option_id, old.option_name, old.started_at, old.started_by, old.assigned_attendant, old.created_at) then
    raise exception 'Session details cannot be changed after starting' using errcode = '42501';
  end if;
  if old.status = 'ended' then
    raise exception 'Ended sessions cannot be changed' using errcode = '42501';
  end if;
  if new.status = 'active' then
    if new.ends_at <= old.ends_at or new.ends_at > old.ends_at + interval '180 minutes'
       or new.ended_at is not null or new.ended_by is not null then
      raise exception 'Use an allowed session extension or end operation' using errcode = '42501';
    end if;
  elsif new.status = 'ended' then
    if new.ends_at is distinct from old.ends_at or new.ended_at is null
       or new.ended_by is distinct from (select auth.uid()) then
      raise exception 'Use the authorized session end operation' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger lounge_session_update_guard before update on public.lounge_sessions
for each row execute function public.guard_session_update();

create function public.start_lounge_session(p_table_label text, p_option_id uuid, p_assigned_attendant uuid default null)
returns public.lounge_sessions language plpgsql set search_path = ''
as $$
declare
  selected_option public.shisha_options;
  new_session public.lounge_sessions;
  actor uuid := (select auth.uid());
begin
  if not (select public.has_cashier_role()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  if char_length(trim(p_table_label)) not between 1 and 32 then
    raise exception 'Table label must be between 1 and 32 characters' using errcode = '22023';
  end if;
  select * into selected_option from public.shisha_options
    where id = p_option_id and is_available;
  if not found then
    raise exception 'Selected shisha option is unavailable' using errcode = '22023';
  end if;
  if p_assigned_attendant is not null and not exists (
    select 1 from public.staff_profiles where user_id = p_assigned_attendant and role = 'attendant'
  ) then
    raise exception 'Assigned staff member must have attendant role' using errcode = '22023';
  end if;
  insert into public.lounge_sessions (table_label, option_id, option_name, started_at, ends_at, status, started_by, assigned_attendant)
  values (trim(p_table_label), selected_option.id, selected_option.name, now(),
    now() + make_interval(mins => selected_option.duration_minutes), 'active', actor, p_assigned_attendant)
  returning * into new_session;
  return new_session;
end;
$$;
revoke all on function public.start_lounge_session(text, uuid, uuid) from public;
grant execute on function public.start_lounge_session(text, uuid, uuid) to authenticated;

create function public.extend_lounge_session(p_session_id uuid, p_minutes integer)
returns public.lounge_sessions language plpgsql set search_path = ''
as $$
declare
  updated_session public.lounge_sessions;
begin
  if not (select public.has_cashier_role()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  if p_minutes < 5 or p_minutes > 180 then
    raise exception 'Extension must be between 5 and 180 minutes' using errcode = '22023';
  end if;
  update public.lounge_sessions
    set ends_at = ends_at + make_interval(mins => p_minutes)
    where id = p_session_id and status = 'active' and ends_at > now()
    returning * into updated_session;
  if not found then
    raise exception 'Session is no longer active or has already expired' using errcode = '40001';
  end if;
  return updated_session;
end;
$$;
revoke all on function public.extend_lounge_session(uuid, integer) from public;
grant execute on function public.extend_lounge_session(uuid, integer) to authenticated;

create function public.end_lounge_session(p_session_id uuid)
returns public.lounge_sessions language plpgsql set search_path = ''
as $$
declare
  ended_session public.lounge_sessions;
begin
  if not (select public.has_cashier_role()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  update public.lounge_sessions
    set status = 'ended', ended_at = now(), ended_by = (select auth.uid())
    where id = p_session_id and status = 'active'
    returning * into ended_session;
  if not found then
    raise exception 'Session is already ended or not available' using errcode = '40001';
  end if;
  return ended_session;
end;
$$;
revoke all on function public.end_lounge_session(uuid) from public;
grant execute on function public.end_lounge_session(uuid) to authenticated;

create view public.session_board with (security_invoker = true) as
select id, table_label, option_name, started_at, ends_at, status, started_by, assigned_attendant,
  case
    when status = 'ended' then 'ended'
    when ends_at <= statement_timestamp() then 'overdue'
    when ends_at <= statement_timestamp() + interval '10 minutes' then 'ending_soon'
    else 'active'
  end as timing_status
from public.lounge_sessions;

alter table public.staff_profiles enable row level security;
alter table public.shisha_options enable row level security;
alter table public.lounge_sessions enable row level security;
alter table public.audit_events enable row level security;

create policy "Staff can view own profile or management can view all"
on public.staff_profiles for select to authenticated
using (user_id = (select auth.uid())
  or (select public.has_management_role())
  or ((select public.has_cashier_role()) and role = 'attendant'));
create policy "Management can add staff"
on public.staff_profiles for insert to authenticated
with check ((select public.has_management_role()));
create policy "Management can update staff roles"
on public.staff_profiles for update to authenticated
using ((select public.has_management_role()))
with check ((select public.has_management_role()));
create policy "Management can remove staff"
on public.staff_profiles for delete to authenticated
using ((select public.has_management_role()));

create policy "Staff can view shisha options"
on public.shisha_options for select to authenticated using (true);
create policy "Management controls shisha options"
on public.shisha_options for all to authenticated
using ((select public.has_management_role()))
with check ((select public.has_management_role()));

create policy "Cashiers and managers can view sessions"
on public.lounge_sessions for select to authenticated
using ((select public.has_cashier_role()) or assigned_attendant = (select auth.uid()));
create policy "Cashiers and managers can start sessions"
on public.lounge_sessions for insert to authenticated
with check ((select public.has_cashier_role()) and started_by = (select auth.uid()));
create policy "Cashiers and managers can update sessions"
on public.lounge_sessions for update to authenticated
using ((select public.has_cashier_role()))
with check ((select public.has_cashier_role()));

create policy "Staff can view own audit events and management can view all"
on public.audit_events for select to authenticated
using (actor_id = (select auth.uid()) or (select public.has_management_role()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.staff_profiles to authenticated;
grant select, insert, update, delete on public.shisha_options to authenticated;
grant select, insert, update on public.lounge_sessions to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.session_board to authenticated;

insert into public.shisha_options (name, duration_minutes, price_cents) values
  ('Classic Session', 60, 0),
  ('Extended Session', 90, 0),
  ('Long Session', 120, 0);

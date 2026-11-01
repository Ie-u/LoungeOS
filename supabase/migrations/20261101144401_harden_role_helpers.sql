create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.has_management_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and role in ('owner', 'admin')
  );
$$;
revoke all on function private.has_management_role() from public, anon;
grant execute on function private.has_management_role() to authenticated;

create function private.has_cashier_role()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = (select auth.uid()) and role in ('owner', 'admin', 'cashier')
  );
$$;
revoke all on function private.has_cashier_role() from public, anon;
grant execute on function private.has_cashier_role() to authenticated;

alter policy "Staff can view own profile or management can view all" on public.staff_profiles
using (user_id = (select auth.uid()) or (select private.has_management_role())
  or ((select private.has_cashier_role()) and role = 'attendant'));
alter policy "Management can add staff" on public.staff_profiles
with check ((select private.has_management_role()));
alter policy "Management can update staff roles" on public.staff_profiles
using ((select private.has_management_role())) with check ((select private.has_management_role()));
alter policy "Management can remove staff" on public.staff_profiles
using ((select private.has_management_role()));

drop policy "Staff can view shisha options" on public.shisha_options;
drop policy "Management controls shisha options" on public.shisha_options;
create policy "Staff can view shisha options" on public.shisha_options
for select to authenticated using (true);
create policy "Management can add shisha options" on public.shisha_options
for insert to authenticated with check ((select private.has_management_role()));
create policy "Management can update shisha options" on public.shisha_options
for update to authenticated using ((select private.has_management_role()))
with check ((select private.has_management_role()));
create policy "Management can remove shisha options" on public.shisha_options
for delete to authenticated using ((select private.has_management_role()));

alter policy "Cashiers and managers can view sessions" on public.lounge_sessions
using ((select private.has_cashier_role()) or assigned_attendant = (select auth.uid()));
alter policy "Cashiers and managers can start sessions" on public.lounge_sessions
with check ((select private.has_cashier_role()) and started_by = (select auth.uid()));
alter policy "Cashiers and managers can update sessions" on public.lounge_sessions
using ((select private.has_cashier_role())) with check ((select private.has_cashier_role()));
alter policy "Staff can view own audit events and management can view all" on public.audit_events
using (actor_id = (select auth.uid()) or (select private.has_management_role()));

create or replace function public.start_lounge_session(p_table_label text, p_option_id uuid, p_assigned_attendant uuid default null)
returns public.lounge_sessions language plpgsql set search_path = ''
as $$
declare
  selected_option public.shisha_options;
  new_session public.lounge_sessions;
  actor uuid := (select auth.uid());
begin
  if not (select private.has_cashier_role()) then
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

create or replace function public.extend_lounge_session(p_session_id uuid, p_minutes integer)
returns public.lounge_sessions language plpgsql set search_path = ''
as $$
declare updated_session public.lounge_sessions;
begin
  if not (select private.has_cashier_role()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  if p_minutes < 5 or p_minutes > 180 then
    raise exception 'Extension must be between 5 and 180 minutes' using errcode = '22023';
  end if;
  update public.lounge_sessions set ends_at = ends_at + make_interval(mins => p_minutes)
    where id = p_session_id and status = 'active' and ends_at > now()
    returning * into updated_session;
  if not found then
    raise exception 'Session is no longer active or has already expired' using errcode = '40001';
  end if;
  return updated_session;
end;
$$;

create or replace function public.end_lounge_session(p_session_id uuid)
returns public.lounge_sessions language plpgsql set search_path = ''
as $$
declare ended_session public.lounge_sessions;
begin
  if not (select private.has_cashier_role()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  update public.lounge_sessions set status = 'ended', ended_at = now(), ended_by = (select auth.uid())
    where id = p_session_id and status = 'active'
    returning * into ended_session;
  if not found then
    raise exception 'Session is already ended or not available' using errcode = '40001';
  end if;
  return ended_session;
end;
$$;

drop function public.has_management_role();
drop function public.has_cashier_role();
revoke all on function public.create_staff_profile() from public, anon, authenticated;
revoke all on function public.write_session_audit() from public, anon, authenticated;
revoke all on function public.guard_session_update() from public, anon, authenticated;
revoke all on function public.write_staff_role_audit() from public, anon, authenticated;

create index if not exists lounge_sessions_option_id_idx on public.lounge_sessions (option_id);
create index if not exists lounge_sessions_started_by_idx on public.lounge_sessions (started_by);
create index if not exists lounge_sessions_ended_by_idx on public.lounge_sessions (ended_by);
create index if not exists audit_events_actor_id_idx on public.audit_events (actor_id);

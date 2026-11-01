-- Owner self-service profile editing, private avatar storage, and focused
-- operational counts for the owner dashboard.

alter table public.staff_profiles
  add column avatar_path text,
  add constraint staff_profiles_avatar_path_check
    check (avatar_path is null or avatar_path = user_id::text || '/avatar');

create or replace function private.guard_staff_profile_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare actor_role text;
begin
  select role into actor_role from public.staff_profiles
    where user_id = (select auth.uid()) and is_active;
  if actor_role is null then
    raise exception 'Active staff management access is required' using errcode = '42501';
  end if;

  if new.user_id = (select auth.uid()) then
    if actor_role <> 'owner'
      or row(new.user_id, new.role, new.is_active, new.deactivated_at, new.deactivated_by, new.created_at)
        is distinct from row(old.user_id, old.role, old.is_active, old.deactivated_at, old.deactivated_by, old.created_at)
      or char_length(trim(coalesce(new.display_name, ''))) not between 1 and 100
      or (new.avatar_path is not null and new.avatar_path <> new.user_id::text || '/avatar') then
      raise exception 'Owners may only update their own display name and profile picture' using errcode = '42501';
    end if;
    new.updated_at := statement_timestamp();
    return new;
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
  new.avatar_path := old.avatar_path;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create policy "Owners edit their own profile"
on public.staff_profiles for update to authenticated
using (user_id = (select auth.uid()) and (select private.has_owner_role()))
with check (user_id = (select auth.uid()) and (select private.has_owner_role()));
grant update (display_name, avatar_path) on public.staff_profiles to authenticated;

create or replace function private.audit_owner_profile_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.display_name is distinct from new.display_name
    or old.avatar_path is distinct from new.avatar_path then
    insert into public.audit_events (actor_id, entity_type, entity_id, action, after_data)
    values ((select auth.uid()), 'staff_profile', new.user_id, 'owner_profile_updated',
      jsonb_build_object('display_name_changed', old.display_name is distinct from new.display_name,
        'avatar_changed', old.avatar_path is distinct from new.avatar_path));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_owner_profile_changes() from public, anon, authenticated;
create trigger owner_profile_audit after update of display_name, avatar_path on public.staff_profiles
for each row execute function private.audit_owner_profile_changes();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-avatars', 'staff-avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners read own avatar"
on storage.objects for select to authenticated
using (bucket_id = 'staff-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.has_owner_role()));
create policy "Owners upload own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'staff-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (select auth.uid())::text || '/avatar'
  and (select private.has_owner_role()));
create policy "Owners replace own avatar"
on storage.objects for update to authenticated
using (bucket_id = 'staff-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.has_owner_role()))
with check (bucket_id = 'staff-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name = (select auth.uid())::text || '/avatar'
  and (select private.has_owner_role()));
create policy "Owners remove own avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'staff-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.has_owner_role()));

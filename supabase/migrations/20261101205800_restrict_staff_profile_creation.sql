-- New staff profiles are created only by the trusted auth.users trigger. Staff
-- managers cannot attach an arbitrary existing auth account to the staff table.

drop policy if exists "Managers can add lower privilege staff" on public.staff_profiles;
revoke insert on public.staff_profiles from public, anon, authenticated;
drop trigger if exists staff_profile_access_guard on public.staff_profiles;
create trigger staff_profile_access_guard before update on public.staff_profiles
for each row execute function private.guard_staff_profile_changes();

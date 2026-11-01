create function public.write_staff_role_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role is distinct from new.role then
    insert into public.audit_events (actor_id, entity_type, entity_id, action, before_data, after_data)
    values ((select auth.uid()), 'staff_profile', new.user_id, 'staff_role_changed',
      jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
  end if;
  return new;
end;
$$;
revoke all on function public.write_staff_role_audit() from public;
create trigger staff_role_audit after update of role on public.staff_profiles
for each row execute function public.write_staff_role_audit();

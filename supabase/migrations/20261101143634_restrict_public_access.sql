revoke all on public.staff_profiles, public.shisha_options, public.lounge_sessions, public.audit_events, public.session_board from anon, public;
revoke all on sequence public.audit_events_id_seq from anon, public;
revoke all on function public.create_staff_profile() from public;
revoke all on function public.write_session_audit() from public;
revoke all on function public.guard_session_update() from public;

-- Reassert the authenticated grants after removing default public/anonymous table access.
grant select, insert, update, delete on public.staff_profiles to authenticated;
grant select, insert, update, delete on public.shisha_options to authenticated;
grant select, insert, update on public.lounge_sessions to authenticated;
grant select on public.audit_events, public.session_board to authenticated;

create or replace function private.audit_shisha_option_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not (select private.has_admin_role()) then
    raise exception 'Owner or admin access is required to change session presets' using errcode='42501';
  end if;
  if tg_op = 'INSERT' then
    insert into public.audit_events(actor_id,entity_type,entity_id,action,after_data)
    values (actor,'shisha_option',new.id,'session_preset_created',
      jsonb_build_object('name',new.name,'duration_minutes',new.duration_minutes,'price_cents',new.price_cents,'is_available',new.is_available));
    return new;
  end if;
  if row(old.name,old.duration_minutes,old.price_cents,old.is_available)
    is distinct from row(new.name,new.duration_minutes,new.price_cents,new.is_available) then
    insert into public.audit_events(actor_id,entity_type,entity_id,action,before_data,after_data)
    values (actor,'shisha_option',new.id,'session_preset_changed',
      jsonb_build_object('name',old.name,'duration_minutes',old.duration_minutes,'price_cents',old.price_cents,'is_available',old.is_available),
      jsonb_build_object('name',new.name,'duration_minutes',new.duration_minutes,'price_cents',new.price_cents,'is_available',new.is_available));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_shisha_option_change() from public, anon, authenticated;
create trigger shisha_option_audit after insert or update on public.shisha_options
for each row execute function private.audit_shisha_option_change();

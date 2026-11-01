create or replace view public.session_board with (security_invoker = true) as
select id, table_label, option_name, started_at, ends_at, status, started_by, assigned_attendant,
  case
    when status = 'ended' then 'ended'
    when ends_at <= statement_timestamp() then 'overdue'
    when ends_at <= statement_timestamp() + make_interval(mins => coalesce(
      (select session_alert_minutes from public.business_settings where singleton), 10)) then 'ending_soon'
    else 'active'
  end as timing_status
from public.lounge_sessions;

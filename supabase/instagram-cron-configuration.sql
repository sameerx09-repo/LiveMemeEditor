-- Run once in Supabase SQL Editor before production-scheduler.sql.
-- Safe to reapply: installs an ADMIN-ONLY configurator; does not run/enable jobs.
-- pg_cron must already be enabled. The scheduler's cron.timezone must be UTC/GMT.
create or replace function public.configure_instagram_cron(
  p_interval_minutes integer default 60,
  p_timezone text default 'Asia/Kolkata'
)
returns table (
  job_id bigint,
  interval_minutes integer,
  schedule_timezone text,
  cron_expression text,
  is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_id bigint;
  v_active boolean;
  v_offset integer;
  v_minutes text;
  v_expression text;
  v_timezone text;
begin
  if p_interval_minutes is null or p_interval_minutes < 1 or p_interval_minutes > 60 then
    raise exception 'Interval must be a whole-minute divisor of 60, between 1 and 60';
  end if;
  if 60 % p_interval_minutes <> 0 then
    raise exception 'Use a clock-aligned interval such as 1, 5, 10, 15, 20, 30 or 60 minutes (not 59)';
  end if;
  if p_timezone is null or p_timezone not in ('UTC', 'Asia/Kolkata', 'Asia/Calcutta') then
    raise exception 'Supported fixed-offset clock timezones: UTC or Asia/Kolkata';
  end if;
  if lower(coalesce(current_setting('cron.timezone', true), 'GMT')) not in ('utc', 'gmt', 'etc/utc', 'etc/gmt') then
    raise exception 'This configurator requires UTC/GMT cron.timezone; do not apply a second timezone offset';
  end if;
  v_timezone := case when p_timezone = 'UTC' then 'UTC' else 'Asia/Kolkata' end;
  v_offset := case when v_timezone = 'UTC' then 0 else 330 end;
  select j.jobid, j.active into v_job_id, v_active
  from cron.job as j where j.jobname = 'clipmeme-production-instagram';
  if v_job_id is null then
    raise exception 'Create the production scheduler job first';
  end if;
  select string_agg(m.minute::text, ',' order by m.minute) into v_minutes
  from generate_series(0, 59) as m(minute)
  where (m.minute + v_offset) % p_interval_minutes = 0;
  v_expression := case when p_interval_minutes = 1 then '* * * * *' else v_minutes || ' * * * *' end;
  -- Change cadence only. Preserve active state, command, secret reference and posts.
  perform cron.alter_job(v_job_id, schedule := v_expression);
  return query select v_job_id, p_interval_minutes, v_timezone, v_expression, v_active;
end;
$function$;

revoke all on function public.configure_instagram_cron(integer, text) from public, anon, authenticated;
grant execute on function public.configure_instagram_cron(integer, text) to service_role;

-- After creating the job, change the interval at any time (no Vercel redeploy):
-- select * from public.configure_instagram_cron(60, 'Asia/Kolkata'); -- 08:00, 09:00 IST
-- select * from public.configure_instagram_cron(30, 'Asia/Kolkata'); -- 08:00, 08:30 IST
-- select * from public.configure_instagram_cron(1, 'Asia/Kolkata');  -- every minute

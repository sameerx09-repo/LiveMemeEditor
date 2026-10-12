-- Run once in Supabase SQL Editor after instagram-posting.sql and enabling Cron.
-- Installs an ADMIN-ONLY switch. Installation never activates or runs the job.
begin;

create or replace function public.set_instagram_cron_enabled(p_enabled boolean)
returns table (
  job_id bigint,
  is_active boolean,
  skipped_posts bigint,
  checked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_id bigint;
  v_was_active boolean;
  v_skipped bigint := 0;
  v_now timestamptz;
begin
  if p_enabled is null then
    raise exception 'Pass true to resume or false to pause';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clipmeme-production-instagram:activation', 0)
  );
  -- Use read-only access to cron.job; the advisory lock serializes our switches.
  select j.jobid, j.active into v_job_id, v_was_active
  from cron.job as j
  where j.jobname = 'clipmeme-production-instagram';
  if v_job_id is null then
    raise exception 'Create the inactive job with production-scheduler.sql first';
  end if;
  v_now := pg_catalog.clock_timestamp();

  if p_enabled and not v_was_active then
    if (select count(*) from vault.decrypted_secrets
        where name = 'clipmeme_production_cron_secret') <> 1
        or not exists (select 1 from vault.decrypted_secrets
          where name = 'clipmeme_production_cron_secret'
            and length(decrypted_secret) > 0) then
      raise exception 'Create exactly one non-empty clipmeme_production_cron_secret in Vault first';
    end if;
    -- Resume future work only. Keep missed posts visible without replaying them.
    update public.instagram_posts
    set status = 'failed',
        error = 'Skipped: scheduled time passed before the scheduler was enabled. Create a new future schedule.',
        updated_at = v_now
    where status = 'scheduled' and scheduled_at <= v_now;
    get diagnostics v_skipped = row_count;
  end if;

  perform cron.alter_job(v_job_id, active := p_enabled);
  return query select v_job_id, p_enabled, v_skipped, v_now;
end;
$function$;

revoke all on function public.set_instagram_cron_enabled(boolean) from public, anon, authenticated;
grant execute on function public.set_instagram_cron_enabled(boolean) to service_role;
commit;

-- Run ONE command below separately in SQL Editor. Save each as a SQL snippet.
-- OFF: select * from public.set_instagram_cron_enabled(false);
-- ON:  select * from public.set_instagram_cron_enabled(true);
-- This is a GLOBAL admin control for every user's schedules, not a user setting.
-- Pausing cannot stop an HTTP request or Instagram publish already in progress.
-- Do not use the dashboard's Active toggle to resume: it bypasses missed-post cleanup.

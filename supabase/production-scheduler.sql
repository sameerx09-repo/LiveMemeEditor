-- Optional external scheduler for Vercel Hobby. Run only after deployment setup.
-- First run instagram-cron-configuration.sql to install the admin configurator.
-- Enable pg_cron and pg_net first. In Supabase Vault, create ONE secret named
-- clipmeme_production_cron_secret whose value matches INSTAGRAM_CRON_SECRET.
-- This script prepares an INACTIVE job. It never publishes during setup.
begin;
do $$
begin
  if (select count(*) from vault.decrypted_secrets where name = 'clipmeme_production_cron_secret') <> 1 then
    raise exception 'Create exactly one clipmeme_production_cron_secret in Vault first';
  end if;
  if exists (select 1 from cron.job where jobname = 'clipmeme-production-instagram') then
    raise exception 'Production cron already exists; inspect it rather than replacing it';
  end if;
end $$;
select cron.schedule(
  'clipmeme-production-instagram',
  '30 * * * *', -- UTC minute 30 is the top of each hour in India (UTC+05:30).
  $job$
    select net.http_post(
      url := 'https://www.instantmemeeditandpost.online/api/instagram/run-due',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'clipmeme_production_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
  $job$
);
select cron.alter_job(jobid, active := false)
from cron.job where jobname = 'clipmeme-production-instagram';
-- Default: 60-minute clock cadence in India. The job stays INACTIVE.
select * from public.configure_instagram_cron(60, 'Asia/Kolkata');
commit;
-- Install instagram-cron-controls.sql, then use set_instagram_cron_enabled(true)
-- ONLY after configuring a fresh production INSTAGRAM_SCHEDULER_NOT_BEFORE
-- cutoff, external mode and verifying the domain. See SCHEDULER.md.

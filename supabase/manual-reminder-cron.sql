-- Requires pg_cron, pg_net and the existing clipmeme_production_cron_secret in Vault.
-- Run after manual-reminders.sql. Creates an INACTIVE job; no emails during setup.
begin;
do $$ begin
  if (select count(*) from vault.decrypted_secrets where name='clipmeme_production_cron_secret') <> 1 then
    raise exception 'Create exactly one clipmeme_production_cron_secret in Vault';
  end if;
  if not exists (select 1 from cron.job where jobname='clipmeme-manual-reminders') then
    perform cron.schedule('clipmeme-manual-reminders','* * * * *', $job$
      select net.http_post(
        url := 'https://www.instantmemeeditandpost.online/api/manual-posts/run-due',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name='clipmeme_production_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 300000);
    $job$);
    perform cron.alter_job((select jobid from cron.job where jobname='clipmeme-manual-reminders'),active := false);
  end if;
end $$;
create or replace function public.set_manual_reminders_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_id bigint; v_active boolean;
begin
  if p_enabled is null then raise exception 'Enabled must be true or false'; end if;
  select jobid,active into v_id,v_active from cron.job where jobname='clipmeme-manual-reminders';
  if v_id is null then raise exception 'Create the manual reminder cron first'; end if;
  if p_enabled and not v_active then
    update public.instagram_manual_posts set status='skipped',error='Reminder predates activation',updated_at=now()
      where status='scheduled' and scheduled_at < now();
  end if;
  perform cron.alter_job(v_id,active := p_enabled);
end $$;
revoke all on function public.set_manual_reminders_enabled(boolean) from public,anon,authenticated;
grant execute on function public.set_manual_reminders_enabled(boolean) to service_role;
commit;
-- ON:  select public.set_manual_reminders_enabled(true);
-- OFF: select public.set_manual_reminders_enabled(false);
-- This is independent of clipmeme-production-instagram; do not alter that job.

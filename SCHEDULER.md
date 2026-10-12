# Production Instagram Scheduler

One Supabase Cron job checks due posts for all users. Each post uses its owner's
Pro membership and original Instagram connection. The initial cadence is hourly
at 08:00, 09:00, etc. in India time, not every 59 minutes. Off-grid posts wait
until the next tick; Instagram processing can add delay.

## One-Time Activation

1. In Vercel Production environment variables, set:

   ```dotenv
   INSTAGRAM_SCHEDULER_MODE=external
   INSTAGRAM_SCHEDULER_ENABLED=false
   INSTAGRAM_CRON_SECRET=<a strong private random secret>
   INSTAGRAM_SCHEDULER_NOT_BEFORE=<current UTC timestamp, e.g. ISO format ending in Z>
   ```

   The false flag disables the LOCAL timer; production scheduling uses external
   mode. Keep the existing cron secret if one is already configured. Never use
   the service-role key as the cron secret, or share either in chat/logs.
   To get a fresh activation timestamp, run this in Supabase SQL Editor:

   ```sql
   select to_char(clock_timestamp() at time zone 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS"Z"') as scheduler_not_before;
   ```

   Redeploy Vercel after saving the variables. Keep this cutoff unchanged on
   subsequent deploys/resumes. Confirm the production URL works:
   https://www.instantmemeeditandpost.online

2. Enable Supabase Cron (`pg_cron`) and `pg_net`. In Supabase Vault create exactly
   one secret named `clipmeme_production_cron_secret`, using the SAME value as
   Vercel's `INSTAGRAM_CRON_SECRET`. Do not paste the secret into a SQL snippet
   or the cron command. The job reads it from Vault at run time.

3. With the app's database migrations already applied, run these entire files
   in Supabase SQL Editor in order:

   - `supabase/instagram-cron-configuration.sql`
   - `supabase/production-scheduler.sql`
   - `supabase/instagram-cron-controls.sql`

   Setup creates `clipmeme-production-instagram` INACTIVE. Do not rerun the job
   creation file if that job exists; it deliberately refuses to replace it.
   The configurator/controls files can be reapplied safely without activation.

4. Only after the Vercel deployment and matching Vault secret are ready, run:

   ```sql
   select * from public.set_instagram_cron_enabled(true);
   ```

   This starts FUTURE work on the next hourly tick; it does not publish now.
   On an inactive-to-active transition, all overdue queued posts are marked
   failed with an explanatory message, never replayed. The returned
   `skipped_posts` count tells you how many. Future schedules and history remain.
   Installing a script or setting environment variables alone is not proof
   that the cron job is active or healthy.

## Quick On / Off

Save these as two named SQL snippets in Supabase SQL Editor. No redeploy needed.

```sql
-- OFF / Pause Instagram scheduler
select * from public.set_instagram_cron_enabled(false);
```

```sql
-- ON / Resume future posts only
select * from public.set_instagram_cron_enabled(true);
```

These are GLOBAL administrator controls affecting every user's schedules.
They are not accessible to ordinary Free/Pro app users. Repeating ON while
already active does not discard due work. Pausing stops future cron invocations;
HTTP requests already queued or running, and Instagram publishes in progress,
may still finish. Manual Post to Instagram is unaffected.

Supabase's Cron Jobs page also has an Active/Inactive switch. It is fine for
pausing, but use the SQL ON command to resume: the dashboard switch bypasses
missed-post cleanup and could publish overdue posts from the pause period.
Never select Run now to test with old pending posts.

## Cadence

Run ONE command. This preserves the current on/off state and does not run jobs.

```sql
select * from public.configure_instagram_cron(60, 'Asia/Kolkata'); -- hourly
select * from public.configure_instagram_cron(30, 'Asia/Kolkata'); -- half-hourly
select * from public.configure_instagram_cron(1, 'Asia/Kolkata');  -- every minute
```

Hourly India time is `30 * * * *` on Supabase's UTC/GMT clock. Do not change the
database timezone. One-minute cadence is preferable for arbitrary minute slots
and multi-timezone users. Capacity defaults to ten posts per run across all
users; extra due posts wait for a later tick.

## Check Status

### Calendar Changes

Queued posts can be dragged to a future hourly/half-hour slot. In Days view,
moving a post to another day preserves its local time. The clock icon opens
a date/time editor for keyboard and touch users. Moving changes only the stored
scheduled time, keeping the same post ID, caption, uploaded clip and original
Instagram account; no second upload is needed. Rescheduling remains Pro-only.

The trash icon removes a queued or failed schedule after confirmation. Free
users can also cancel their own schedules. Saved History clips are kept, and
published Instagram posts/history cannot be deleted through these controls.
Posts already publishing cannot be moved or deleted. Concurrent changes return
a conflict and refresh the calendar instead of reporting a false success.
The worker's claim checks the original scheduled time so a stale due-list
snapshot cannot publish a post that has just moved to the future. Deploy the
calendar, edit API and worker together; no additional database migration is
required for these calendar changes. Deleting a schedule does not immediately
delete its uploaded R2 object; existing storage-retention rules still apply.

### Health

```sql
select jobid, jobname, schedule, active
from cron.job where jobname = 'clipmeme-production-instagram';

select r.status, r.start_time, r.end_time, r.return_message
from cron.job_run_details as r
join cron.job as j on j.jobid = r.jobid
where j.jobname = 'clipmeme-production-instagram'
order by r.start_time desc limit 5;

select id, status_code, timed_out, error_msg, created
from net._http_response order by created desc limit 5;
```

Do not select/log `cron.job.command` or request headers: they can contain secrets
if another job was configured insecurely. The HTTP response list is project-wide,
so correlate it with the cron run time. A succeeded cron run only means the HTTP
request was queued. Check the HTTP response and Vercel function logs: 401 means
the secrets do not match; 503 means production activation settings are missing;
3xx/404 suggests a domain/endpoint issue. Even HTTP 200 can include per-post
failures. Verify one NEW future test post and its result; never retry old jobs
or stuck `publishing` posts without first checking Instagram for duplicates.

If an older ON/OFF helper fails with `permission denied for table job` at
`FOR UPDATE`, reapply the current `supabase/instagram-cron-controls.sql` in
SQL Editor as the database administrator, then retry the ON/OFF command. It
uses an advisory lock and read-only access to `cron.job`; job changes go through
`cron.alter_job`. Do not grant direct write access to the cron table. Reapplying
the controls file only replaces the helper and preserves the job's active state.

Sources:
- https://supabase.com/docs/guides/cron/quickstart
- https://supabase.com/docs/guides/functions/schedule-functions
- https://vercel.com/docs/environment-variables

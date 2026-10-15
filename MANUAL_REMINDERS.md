# Finish in Instagram: Email Reminders

This feature is separate from automatic Instagram publishing. Users choose
**Finish in Instagram**, explicitly opt into an email for that post, and select
a future time. An Instagram connection is not required; scheduling remains Pro.

## Production Setup

1. Run `supabase/manual-reminders.sql` in the Supabase SQL Editor before enabling
   reminders. Deploying the code while reminders remain disabled is safe.
   This creates a separate owner-scoped queue; it does not change automatic posts.
2. Configure Resend with a verified sending domain. Create an API key with sending
   access and an address on that domain, such as `reminders@instantmemeeditandpost.online`.
   Never put the key in a `NEXT_PUBLIC_` variable or commit it.
3. Set these **server-side Vercel environment variables**, then redeploy:

   ```dotenv
   RESEND_API_KEY=<your sending API key>
   REMINDER_EMAIL_FROM=ClipMemeEditor <reminders@instantmemeeditandpost.online>
   MANUAL_REMINDERS_BASE_URL=https://www.instantmemeeditandpost.online
   MANUAL_REMINDERS_ENABLED=true
   MANUAL_REMINDERS_NOT_BEFORE=<fresh activation timestamp in UTC ISO 8601>
   ```

   The existing `INSTAGRAM_CRON_SECRET` is reused for server-to-server auth.
   Generate a fresh cutoff using `node -e "console.log(new Date().toISOString())"`.
   Do not reuse an old cutoff when activating a previously inactive deployment.
4. Run `supabase/manual-reminder-cron.sql`. It uses the existing Vault secret
   `clipmeme_production_cron_secret` and creates an **inactive** separate job
   named `clipmeme-manual-reminders`, running once per minute.
5. After verifying deployment and sender configuration, turn it on:

   ```sql
   select public.set_manual_reminders_enabled(true);
   ```

   Turn it off immediately for future runs:

   ```sql
   select public.set_manual_reminders_enabled(false);
   ```

   In-flight emails cannot be recalled. The switch does not affect automatic
   Instagram publishing. Re-enabling skips already-past queued reminders.
   Also set `MANUAL_REMINDERS_ENABLED=false` and redeploy to disable the endpoint
   and new manual schedules. Merely disabling cron does not disable scheduling.

## User Flow

- Calendar -> Finish in Instagram -> select/drag a saved clip -> future time.
- Add a caption and optional `https://www.instagram.com/reels/audio/<id>/` link.
- Check the email consent box; schedule the reminder.
- Email opens `/manual-post/<id>`; login returns to that exact post. Another
  account cannot access it. Video is loaded from the private server copy, not
  the desktop browser's IndexedDB. Links contain no login credentials.
- Tap **Prepare video**, then **Share video** if the browser supports sharing
  files. The OS chooses destinations; Instagram/Reel-composer availability is
  device-specific. **Download video** remains available after preparation.
- **Copy caption** and **Open audio** are separate actions. Audio selection and
  final publishing happen in Instagram; we do not attach trending audio via API.
- **Mark as done** requires confirmation and records user-reported completion,
  not independently verified Instagram publication.

## Delivery Guarantees and Limits

The cron check is minute-based, not an exact delivery guarantee. Email provider
acceptance is not proof of inbox delivery. No web push or QR generation is
included yet; the email link provides the desktop-to-phone handoff.

Database claims use row locks and six-minute leases. Provider idempotency keys
are stable per post/time; Resend retains keys for 24 hours. Retries are limited
to three attempts and a 15-minute due window. Missed reminders are marked skipped
instead of being sent hours later. Changes to a recipient or sender during a
retry can make the provider reject the reused key; this fails safely rather than
silently creating a duplicate email.

Moving a post resets its reminder state; deleting it cancels queued work without
deleting History. While its email is in flight, mutations return a conflict.
Old automatic failed posts are never retried by this feature.

Test on a new future reminder with a confirmed Pro account. Verify the email,
owner-only login return, caption, audio link, Android/iPhone share destinations,
and explicit completion. Unit/browser tests mock delivery; they do not send mail.

References: https://resend.com/docs/api-reference/emails/send-email,
https://resend.com/docs/dashboard/emails/idempotency-keys,
https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

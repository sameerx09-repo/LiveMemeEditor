# Vercel Deployment

Target repository: https://github.com/sameerx09-repo/LiveMemeEditor

Canonical domain: https://www.instantmemeeditandpost.online

Deployment preparation is not public-launch approval. Finish the open items in
security_best_practices_report.md before admitting untrusted public users.

## 1. Repository And Project

The Git root is the directory containing this file and package.json. Push its
contents to the target repository, not the parent directory. Never include real
.env files, output logs, node_modules, .next, or dist. The example environment
file contains no credentials and is intentionally tracked.

Import the repository in Vercel with the Next.js preset and Root Directory `.`.
Use Node.js 24.x (pinned in package.json), `npm ci`, and `npm run build`. Enable Fluid Compute. Do not use
the local npm start launcher as a Vercel background worker. Serverless functions
do not keep its interval timer running.

## 2. Database

Apply supabase/instagram-posting.sql (if not already applied), then
supabase/security-hardening.sql, then supabase/instagram-connections.sql.
The connections script adds server-only atomic connect/disconnect functions;
run it before deploying the profile connection controls. Defining these
functions does not disconnect accounts or change existing posts. Existing
accounts/posts are retained. Verify
ordinary authenticated clients cannot SELECT access_token and the service-role
rate-limit RPC works. Production expensive routes fail closed without this RPC.
These scripts have NOT been applied by deployment preparation.

### Instagram Connections

Users can open their top-right profile to view, connect, disconnect, or change
their Instagram account. Connecting remains available on Free; posting and
scheduling require Pro. Disconnect requires explicit confirmation, erases saved
publishing tokens for that app user, and marks their queued Instagram posts as
failed so reconnecting cannot silently replay them. Published/failed history
and local saved clips remain intact. Switching accounts disconnects first and
then starts the existing Instagram OAuth flow; cancellation leaves the user
disconnected. Posts already publishing may still finish.

This is a local app disconnect, not a Meta-wide permissions revocation or an
account/data-deletion request. No remote Meta account is changed by disconnect.
The worker rereads the specific connection for each claimed post rather than
using a token from its initial due-post snapshot or falling back to another
Instagram account. Manual publishing and scheduling reject a changed target
account and ask the user to confirm again.

## 3. Environment

Use .env.production.example as the list for Vercel Production environment values.
Reuse the existing Supabase, R2 and Instagram credentials; do not put secrets in
NEXT_PUBLIC_ variables or commit them. Generate strong independent random state
and cron secrets. Set APP_URL and INSTAGRAM_REDIRECT_URI exactly as in the example.
Keep the local .env.local unchanged. Run `npm run check:production` with the
production values in your environment; it prints missing variable NAMES only.

### Signup Toggle

Set `SIGNUP_ENABLED=false` in Vercel Production to hide signup and reject app
registration requests. Set it to the literal `true` to enable registration.
When absent, production builds (including previews) default to disabled;
`npm run dev` defaults to enabled. Blank or invalid values disable signup.
Existing users can still sign in. The server reads this flag at request time,
not from a client-bundled NEXT_PUBLIC variable. After changing Vercel environment
variables, redeploy to apply them; restart a local server after editing its env.

This controls the app's UI and `/api/auth/signup`, not Supabase's public Auth API.
For a closed beta that must block direct registration too, disable **Allow new
users to sign up** in Supabase Authentication's general configuration. That is a
project-wide setting (including localhost/previews sharing the same project).
To reopen signup, enable both this app flag and the Supabase setting. No Supabase
dashboard setting is changed by this code. See:
https://supabase.com/docs/guides/auth/general-configuration

Initially keep INSTAGRAM_SCHEDULER_MODE=disabled and
INSTAGRAM_SCHEDULER_ENABLED=false. Do not inherit the old local cutoff: choose a
fresh UTC activation timestamp when intentionally activating production. Retain
that timestamp on later redeploys. Failed, published, and pre-cutoff posts are
not retried by the worker. Existing missed rows are not automatically migrated.

Use an isolated Supabase/R2 project for previews. Vercel previews always reject
cron publishing even if scheduler variables are accidentally present. Never
connect a live Instagram account to an untrusted preview; manual posting remains
an explicit user action. Domain-specific OAuth requires a matching callback for
each environment.

## 4. Domain, Auth And Meta

Use www.instantmemeeditandpost.online as the canonical production domain. Add
both www.instantmemeeditandpost.online and instantmemeeditandpost.online in
Vercel Project Settings > Domains. Apply the
EXACT DNS records Vercel displays at the domain's DNS provider; do not guess IPs
or assume DNS ownership has already been verified. Wait for HTTPS to be valid.
Redirect the apex domain to www; do not run two independent origins. A Vercel
redirect does not fix a missing DNS record: the apex must resolve first.

Set Supabase Authentication > URL Configuration Site URL to
https://www.instantmemeeditandpost.online and allow its auth redirects. Keep
APP_URL and INSTAGRAM_REDIRECT_URI aligned with this same canonical origin.
In Meta > Instagram > Set up Instagram business login > Business login settings,
set OAuth redirect URI to:

    https://www.instantmemeeditandpost.online/api/instagram/callback

Privacy policy URL:

    https://www.instantmemeeditandpost.online/privacy

The privacy page is public and must return 200 without signing in. Before Meta
review, replace its dashboard-only contact reference with a confirmed public
support/privacy email and ensure the described deletion process is operational.
There is currently no /data-deletion page or deletion callback; do not submit
that URL as a working endpoint. A privacy page alone does not complete Meta's
data-deletion or app-review requirements.

Open and sign in on this exact domain before Connect Instagram. Do not use the
Instagram authorization URL as a redirect URI. App review/live-mode eligibility
and deauthorization/data-deletion compliance remain separate launch work.

## 5. Storage And Media Delivery

Merge deploy/r2-cors.json into the existing bucket CORS rules, retaining any
origins needed by existing workflows. Public bucket access and R2_PUBLIC_BASE_URL
are NOT required. Production editor video uploads use short authenticated JSON
prepare/finalize calls plus a direct presigned PUT to R2. Finalization verifies
account-bound ticket, declared bytes/type, object metadata and file header.
Object cleanup/lifecycle rules must keep scheduled media until publishing.

Instagram receives a fresh, one-hour presigned R2 GET URL when publishing. Its
download no longer traverses the app or depends on a local tunnel. App preview
and extension download routes redirect to short-lived private storage links.
Browser CORS must permit GET/HEAD/PUT. Keep presigned links out of logs.

Browser History is origin-local. Clips saved on localhost or the old tunnel do
not automatically appear on the production domain. Download/import clips you
need; existing scheduled media references stay server-side. Do not delete R2
objects or database rows during deployment.

### Extension Upload CORS

The production extension obtains a short-lived upload URL from `/api/presign`,
then PUTs the recording directly to R2 from the source page's origin (for example
`https://www.bilibili.com`), not the editor's origin. A bucket without CORS blocks
that browser upload even when R2 credentials and the signed URL are valid.

Apply `deploy/r2-cors.json` in Cloudflare R2 > bucket > Settings > CORS Policy.
Retain any additional existing rules. The first rule permits editor access on
www, apex and localhost. The second permits PUT from any source website so the
extension can capture across sites; it does not allow wildcard GET or DELETE.
PUT still requires a valid, object-specific signed URL. Do not enable public
bucket access or add R2 credentials to the extension. No app redeployment is
needed to apply a bucket CORS policy; allow up to 30 seconds for propagation.

Extension logs identify `prepare upload`, `read upload ticket` and `storage
upload` separately without logging the token or signed URL. If storage still
fails after CORS is set, inspect the failed PUT/OPTIONS status in the source
tab's Network panel; do not share its signed query string.

## 6. Scheduling: Choose One

Hobby is for non-commercial personal use only. Use an eligible commercial plan
before monetizing Free/Pro subscriptions; the Hobby path below is for personal
testing, not a workaround for commercial hosting terms.

Vercel Hobby Cron only runs daily and cannot provide hourly/minute precision.
The default vercel.json deliberately contains no paid-plan cron requirement.
For Hobby, enable Supabase pg_cron/pg_net, create the Vault secret described in
supabase/production-scheduler.sql, apply supabase/instagram-cron-configuration.sql,
then supabase/production-scheduler.sql. It creates an INACTIVE hourly job aligned
to Asia/Kolkata: 08:00, 09:00, etc. Set INSTAGRAM_SCHEDULER_MODE=external, a fresh activation cutoff and
INSTAGRAM_CRON_SECRET in Vercel, redeploy, then install
supabase/instagram-cron-controls.sql and activate with
`select * from public.set_instagram_cron_enabled(true);`.
This skips overdue queued posts instead of publishing old schedules. See
SCHEDULER.md for the full one-time setup and saved on/off SQL commands. Pause
with `select * from public.set_instagram_cron_enabled(false);`. Resume with the
SQL function, not the dashboard Active switch, to skip posts missed while off.
These admin controls affect all users; in-flight HTTP/publishing may still finish.
Check net._http_response for HTTP status, not only cron.job_run_details: queueing
an HTTP request is not proof that Instagram publishing succeeded.

### Change The Supabase Interval

Run ONE of these commands as the database administrator in Supabase SQL Editor:

```sql
select * from public.configure_instagram_cron(60, 'Asia/Kolkata'); -- hourly
select * from public.configure_instagram_cron(30, 'Asia/Kolkata'); -- half-hourly
select * from public.configure_instagram_cron(1, 'Asia/Kolkata');  -- every minute
```

No Vercel redeploy is required for interval changes. The function preserves the
job's active/inactive state and command and never changes or publishes post rows.
It is unavailable to ordinary signed-in users. It supports clock-aligned minute
divisors of 60, and the fixed-offset UTC/Asia/Kolkata clocks (Asia/Calcutta alias
accepted). A 59-minute setting is rejected: cron minute steps reset each hour,
so `*/59` would mean minute 00 and 59, not a stable 59-minute interval.

Supabase pg_cron normally uses UTC/GMT. The configurator checks this and calculates
the offset: hourly IST is `30 * * * *`, NOT `0 * * * *` (which is :30 IST).
Half-hourly IST is `0,30 * * * *`; every minute is `* * * * *`.
Do not change the database server's timezone or cron.timezone as a workaround.

With hourly checks, an 08:30 post waits until the 09:00 tick. Users in other
timezones still store absolute instants, but this ONE global cron follows India
clock boundaries. Change to one-minute checks for near-minute delivery globally.
Meta processing/cold starts can add delay; cron is not an exact-second guarantee.

INSTAGRAM_SCHEDULER_BATCH_SIZE controls capacity, not frequency. Default production
capacity is 10 posts in parallel per run, configurable from 1 to 20 through Vercel
environment settings (redeploy required for that setting). This is shared across
all users; excess posts wait for a later run. Atomic per-post claims remain in
place. Each user's post uses its own linked account; one user's normal publishing
failure does not stop the other posts. Same-account posts can finish out of order.
This bounded MVP batch is not a durable high-throughput queue. Do not raise it
beyond expected usage without provider-rate-limit and runtime testing.

For Vercel Pro built-in Cron, add this top-level property to vercel.json:

```json
"crons": [{ "path": "/api/instagram/run-due", "schedule": "* * * * *" }]
```

Set INSTAGRAM_SCHEDULER_MODE=vercel and CRON_SECRET to the SAME random value as
INSTAGRAM_CRON_SECRET; set the fresh activation cutoff and redeploy. Do not also
activate the Supabase cron. The endpoint supports authenticated GET and POST,
bounded parallel batches, atomic claims and a 300-second execution cap.
Review jobs stuck in publishing
after a platform timeout against Instagram before retrying, to avoid duplicates.

Merely setting scheduler mode means configured, not monitored/healthy. Confirm
actual cron invocations and a newly scheduled disposable test clip AFTER setup.
No old posts should be retried during that test. No actual cron has been created
or activated by the code preparation.

## 7. Extension And Platform Limits

Run `npm run extension:production`, then load dist/chrome-ext in Chrome. It uses
`https://www.instantmemeeditandpost.online` and direct storage uploads. Sign in on
that exact origin so the extension can receive its authenticated session. The
original chrome-ext folder still targets localhost:3000;
recording/cropping/tab capture logic is unchanged.
Use only one extension build at a time and sign in to its matching editor origin.

Normal editing, rendering, local History and stitching use browser FFmpeg/WASM.
Native server remux/merge/stitch/legacy relay and yt-dlp URL downloading are NOT
available on Vercel; they return an explicit unavailable response. Upload a local
file or use ClipGrab instead of URL downloading. A dedicated isolated media
worker is required to restore server URL downloads without these constraints.

Transcription uses native fetch instead of a system curl binary. Its browser audio
upload is capped at 4 MB (the platform's function payload ceiling is 4.5 MB);
long-podcast asynchronous/direct-storage transcription needs a separate worker.
Browser FFmpeg is CPU/memory heavy, especially on mobile. The product's Free/Pro
entitlements and billing are NOT implemented by this deployment change.

## 8. Verification Before Public Launch

- `npm test -- --runInBand`, `npx tsc --noEmit`, and `npm run build`.
- Confirm domain HTTPS, auth/login/logout, OAuth account binding and real grants.
- Check direct R2 CORS uploads with a clip larger than 4.5 MB and private downloads.
- Smoke-test desktop/mobile browser FFmpeg and production extension capture.
- Confirm one NEW future post, detailed errors and cron health; never retry old ones.
- Complete remaining security/resource-isolation/token-vault and billing work.

Sources: [Vercel limits](https://vercel.com/docs/functions/limitations),
[Cron plans](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[Hobby eligibility](https://vercel.com/docs/plans/hobby),
[Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[Domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/),
[Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).

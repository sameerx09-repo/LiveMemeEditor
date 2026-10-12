# Account Membership

The account menu displays Free or Pro from the current Supabase Auth user record.
`GET /api/account/profile` verifies the caller and reads only that user's record
using the server-side service role. It never accepts a user ID or plan from the
request. Responses are not cached and do not expose raw metadata.

## Membership Source

- No `app_metadata.plan`: Free (including new signups).
- `app_metadata.plan = "pro"`: Pro.
- Optional `app_metadata.plan_expires_at`: ISO timestamp with timezone. Expired
  or malformed values resolve to Free. No expiry means a permanent manual grant.
- User-editable `user_metadata`, local storage and the legacy unused
  `getUserPlan` profiles helper do not drive this display.

Only a trusted backend/admin should grant or remove Pro, using Supabase's
`auth.admin.updateUserById` with `app_metadata`. Preserve existing metadata such
as provider identities. Never expose the service role to the browser, or create
a client-accessible endpoint that accepts a requested plan.

## Enforced Features

Instagram posting and scheduling are Pro-only. Free users can still edit, save
to History, download clips, and connect Instagram. The editor disables posting
and scheduling; the calendar remains readable but cannot accept new schedules.
Instagram upload, publish, and schedule-creation APIs independently read fresh
admin-controlled membership and return 403 for Free/expired Pro accounts. Lookup
failures return 503 and do not upload, schedule, or publish. Extension clip
transport is unchanged.

The scheduled worker also checks membership after claiming each due post and
before contacting Instagram. Free/expired owners' posts are marked failed with
a Pro-required reason, not automatically retried after a later upgrade. The
activation cutoff still excludes old posts. No existing schedules are changed
by deploying alone; checks occur when the worker handles a due post.

Billing and the planned Free auto-trim duration limit are not implemented yet.

## Manual Free / Pro Grants

In Supabase Authentication > Users, find the account's exact UUID. Until billing
is added, an administrator can use the SQL Editor to grant permanent Pro:

```sql
update auth.users
set raw_app_meta_data =
  (coalesce(raw_app_meta_data, '{}'::jsonb) - 'plan_expires_at')
  || '{"plan":"pro"}'::jsonb
where id = 'REPLACE_WITH_USER_UUID'::uuid
returning id, email, raw_app_meta_data->>'plan' as plan;
```

To set the same account back to Free, run the same statement with `"free"`
instead of `"pro"`. Both preserve provider/other app metadata and remove any
previous expiry. A placeholder UUID intentionally fails until replaced; verify
the returned account. Do not change `raw_user_meta_data` or a `profiles.plan`
column: neither grants access. These queries are admin-only, never browser code.
Alternatively use the server-only Supabase Auth admin API described above.

Reload the app or use Refresh membership to update the badge and controls.
Server checks take effect on the next request even without refreshing the JWT.
Changing a plan cannot stop a publish that has already been sent to Instagram.

## Social Signup (Not Yet Implemented)

Recommended flow: email/Google signup, then Connect Instagram for publishing.

For Google:

1. Create a Google Cloud Web application OAuth client.
2. Add the app origin to Authorized JavaScript origins. Add the Supabase Google
   provider's displayed callback URL to Google's Authorized redirect URIs.
3. Enable Google in Supabase Authentication > Providers and enter the Google
   client ID and secret there, not in browser-exposed app environment variables.
4. Add the app callback URLs to Supabase's redirect allowlist, for example
   `https://www.instantmemeeditandpost.online/api/auth/callback` and
   `http://localhost:3000/api/auth/callback` for development.
5. Add a Continue with Google button calling `signInWithOAuth`, and implement
   the app's PKCE callback using `createApiClient().auth.exchangeCodeForSession`.
   Redirect to a fixed same-origin destination after success; handle errors
   without exposing codes/tokens or accepting arbitrary redirect destinations.

Those app callback routes/buttons are not part of the membership display change.
Instagram is currently a session-bound publishing connection, not Supabase app
authentication. Its API login targets professional Business/Creator accounts.
Instagram-only signup would require a separate supported identity/session and
account recovery/linking design; do not use a publishing token as an app session.

References:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
- https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api

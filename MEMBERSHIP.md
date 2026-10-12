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

This change is a profile display, not a billing or feature-enforcement rollout.
It does not disable existing editing, Instagram posting or scheduled jobs.
The planned auto-trim and scheduling restrictions still need shared server-side
entitlements and a payment/admin-grant policy before they can be enabled.

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

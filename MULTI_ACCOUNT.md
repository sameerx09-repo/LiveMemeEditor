# Multiple Instagram destinations

Each app user can connect up to three Instagram accounts in their profile.
Existing Pro requirements for posting and scheduling remain unchanged.

## Database setup

In Supabase SQL Editor, run `supabase/instagram-multi-account.sql` once.
It requires the existing `instagram-connections.sql` and `manual-reminders.sql`
tables and functions. If those have not been installed, run them first, then
the new migration. Do not rerun the older connections migration afterwards:
its original function replaces connections rather than keeping three.

Until the new migration is installed, the application keeps single-account
posting and scheduling, with adding extra connections disabled. Installing
the migration enables destination selection. No new environment values are
needed. This does not activate cron, change its cadence, or retry old posts.

## User workflow

1. Open the profile and choose Connect another account. Authorize each intended
   Instagram professional account separately. Reconnecting an existing account
   does not remove the others. The server enforces a maximum of three.
2. Select one, two, or three destinations when posting or scheduling a clip.
   The video uploads once; each destination has a separate publication result.
3. Calendar cards show the destination handle. Filter by account to inspect its
   queue. Moving or deleting a card affects only that destination's job.
4. Disconnecting an account stops only its queued automatic posts. Posts already
   publishing may finish. Other accounts and manual reminders are unchanged.

Successful destinations are not retried when another fails. Repeating the same
posting request returns existing results instead of publishing again. For an
uncertain response, inspect the calendar and Instagram before creating a new
request. Existing failed schedules are never automatically retried.

Manual reminders can target connected accounts or up to three entered handles.
Each destination gets its own reminder and completion state. The handoff page
shows the intended handle, but the user must select the correct account inside
Instagram; the browser cannot force Instagram's active account.

## Verification boundary

Automated tests and browser fixtures do not publish to Instagram, send email,
modify Supabase, or activate workers. After applying the migration, connect the
accounts and test a new future schedule with explicit approval to publish.

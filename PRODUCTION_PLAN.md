# ClipMemeEditor Production Plan

Date: 2026-10-11. Status: product/hosting proposal; approved security remediation is underway. Free/Pro entitlements and billing have not been implemented. See the security report for current fixes and required Supabase migration.

## Product Decisions

Confirmed: Free and Pro versions; Free has a short auto-trim limit described as `<10s`; Instagram scheduling is Pro-only. Preserve working capture/editor/posting flows and local Save to History.

| Capability | Free | Pro | Status |
| --- | --- | --- | --- |
| Edit clips, captions and overlays | Available | Available | Recommended baseline |
| Save to local history / download | Available | Available | Preserve local-first workflow |
| Auto-trim duration | Short-clip limit around 10 seconds | Longer clips, bounded cap TBD | Requested; exact boundary/scope pending |
| Instagram post now | Keep available, bounded quota TBD | Available, higher bounded quota TBD | Recommendation, not approved pricing policy |
| Instagram calendar scheduling | Not permitted | Available | Required |
| AI transcription / hosted processing | Small allowance or explicit upgrade gate | Larger bounded allowance | Cost policy TBD |
| Connected accounts / pending posts | Depends on manual-post policy | Bounded limits | Values TBD |

Do not introduce watermarks, disable existing local tools, advertise unlimited hosted use or choose a price without approval.

### Duration Decision

Two different policies are possible:

1. **All Free outputs are short:** auto-trim a longer selection; include stitched total duration and every save/download/post path. This is broader than limiting only auto-trim.
2. **Only auto-trim is limited:** manual trimming/stitching may still create longer outputs. This limits a feature, not every resulting clip.

Confirm which is intended and whether exactly 10 seconds is allowed. Validate frame/time precision, not rounded UI seconds. Warn before shortening and never modify original media destructively. Do not apply a hard cap to every export until approved.

## Entitlements And Billing

### Server-Owned Policy

The existing [getUserPlan](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/supabase-server.ts:81) reads free/paid but is unused. This is not an implemented paywall.

- Centralize free/pro features and limits: trim duration, hosted media size/duration, scheduling, connected accounts, pending jobs, posting and AI usage.
- Store subscription/entitlement state in server-controlled tables. RLS/grants must prevent clients editing tier, subscription status, quotas or usage counters. Explicitly migrate legacy paid values.
- Expose a read-only authenticated entitlement endpoint for UI. Recheck permissions in API routes and the publishing worker; hiding a tab is not authorization.
- Deny Free schedule creation server-side with a stable upgrade-required error. Keep job history readable. Validate future time, horizon, owned media, token/account readiness and pending-job limits.
- Reserve/release hosted usage atomically and use idempotent request/job keys. In-memory counters do not work across replicas.
- Fail closed for new paid operations when subscription verification is unavailable, without deleting local history or interrupting a local edit.

### Client Exports Are Not A Strong Paywall

The browser currently renders/records local exports. Users can modify browser JavaScript, so a local-only duration cap cannot be tamper-proof. Apply the approved policy consistently to ordinary UI workflows and enforce all hosted paid capabilities using server-validated media metadata.

If unbypassable duration limits on every downloaded file are required, final rendering needs a trusted service. This adds upload/compute/privacy implications and requires a separate decision. It is not a reason to silently upload Save to History.

### Payments

Choose a provider after confirming business country, currency, recurring-payment and support needs. No provider/price/account is selected.

- Create checkout server-side using allowlisted price IDs and authenticated account mapping.
- Grant Pro only from verified provider events/reconciled subscription state, never success URLs, browser values or editable user metadata.
- Verify signatures over exact raw webhook bodies; deduplicate events and handle retries/out-of-order delivery. If Stripe is selected, use its [webhook documentation](https://docs.stripe.com/events/manage-webhook-endpoints).
- Store customer/subscription IDs and effective access dates, not payment card details. Provide billing portal, receipts, cancellation and clear renewal/refund/support terms.
- Recommended cancellation behavior: retain Pro until paid-through date. Afterwards block new schedules and visibly pause unposted jobs instead of silently sending/deleting them. Confirm failed-payment grace/refund behavior.
- Recheck entitlement immediately before dispatch and coordinate cancellations/downgrades with job claims. Once Meta accepts publishing, do not promise recall.
- Test payment, renewal, failure, cancellation, refund, duplicate/delayed events and tampered checkout.

## Production Architecture

Recommended starting point: production-built Next.js service plus separately supervised always-on publishing worker, existing Supabase and private R2. Isolate native/media processing in bounded workers rather than unrestricted web processes.

```text
Browser / production-configured extension
  -> permanent HTTPS app domain
  -> Next.js API (auth, entitlement checks, job admission)
  -> Supabase (protected metadata/jobs, server-only credentials)
  -> private R2 (transfer/staged publishing media)

Supervised scheduler worker
  -> atomic due-job claims + recovery/reconciliation
  -> fresh signed media access -> Meta -> persisted outcome

Verified payment webhook
  -> server-owned subscription state -> entitlements
```

This recommends architecture, not a hosting vendor or purchase. Measure representative jobs/uploads before choosing capacity and budget.

### Hosting Requirements

- Production build/start, supported Node LTS and reproducible Linux image; maintained ffmpeg/ffprobe/yt-dlp if retained. Non-root workers with CPU/memory/tmp/network limits and deadlines.
- Keep local port 3000. Production HTTPS 443 can map to internal 3000; do not change the development port.
- Do not rely on a laptop, quick Cloudflare tunnel, development server or open browser tab for production scheduling.
- Existing 500 MB API upload paths do not fit unchanged into Vercel Functions: documented request/response payload limit is 4.5 MB. Serverless remains possible after redesigning media transfer, processing and worker execution. [Vercel limits](https://vercel.com/docs/functions/limitations).
- Scoped direct-to-private-storage uploads can reduce API memory pressure. Require quota reservations and a finalize step verifying ownership, byte size, actual format and duration before processing/publishing.
- Separate development/staging/production secrets and resources. Never expose service-role, R2, Meta app, cron or webhook secrets in NEXT_PUBLIC variables/extension bundles.
- Fixed canonical HTTPS origin, stable OAuth callback and explicit trusted proxy rules. Tighten production CORS while preserving required authenticated extension uploads.
- Update extension bridge/allowed origins/editor URL and logout handling for production without changing video capture behavior.

## Scheduling Reliability

The working local launcher checks every 30 seconds. [run-due.ts](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/instagram/run-due.ts:42) already atomically claims scheduled -> publishing, but paid scheduling needs durable recovery.

1. Persist leases/claim expiry, attempts and next retry time. Extend states for cancelled/paused/skipped and define recovery of abandoned publishing claims.
2. Persist Meta creation/container IDs before publishing and record operation phase/intent. Reconcile timeouts/crashes rather than blindly creating another post. HTTP retry alone cannot guarantee exactly-once external publishing.
3. Bounded transient retries/backoff; invalid token/media failures need user action. Surface failure details with safe retry/cancel controls. Reconcile ambiguous publish outcomes before retrying.
4. Track token expiry/refresh/reconnect state. Current exchange returns a token string and can fall back to a short-lived token; this is insufficient for long-horizon scheduling.
5. Add actual worker heartbeat, last-success/lag, stuck-job/failure alerts and cost monitoring. Configured/enabled is not evidence of worker health.
6. Store UTC and display/select in user timezone. Reject past times server-side; test timezone/DST boundaries. Calendar slot precision does not guarantee exact publish completion time.
7. Choose maximum horizon and lateness window. Pause/skip excessively late jobs rather than publishing a backlog after an outage. Post-now remains an explicit action.
8. **Never publish old jobs during migration.** Existing old jobs are excluded by INSTAGRAM_SCHEDULER_NOT_BEFORE, not necessarily a durable skipped status. Before removing that guard, explicitly migrate reviewed old jobs to skipped/cancelled. Preserve the guard until an approved migration is verified; do not reset it automatically on restart.
9. Test two worker replicas, restart during container creation/publish/result-save, outage, cancellation and recovery with mocked Meta first, then a controlled test-account post.

### URL Expiry Versus Object Retention

- Save to History/download stay local. History is origin/device-specific and can be evicted; it is not cross-device backup.
- Confirmed scheduling stages a clip so it can publish with the browser closed. Servers cannot later read the user's IndexedDB on their own.
- Current scheduling stores an owned storage reference and creates a fresh 24-hour signed URL at dispatch. Expiry of an upload-time URL does **not by itself** invalidate a later scheduled post now.
- Fresh signatures cannot restore a file deleted by R2 lifecycle rules. Actual rules were not inspected; a source comment mentioning 24 hours does not establish a deployed deletion policy.
- Separate short-lived extension-transfer prefixes from staged scheduled-media retention. Keep staged files through due time and retry grace, then clean them up under a bounded policy. Cloudflare supports prefix-specific [object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
- Store canonical object references, not expiring URLs. Keep R2 private: **a public R2 bucket/base URL is not required**. Meta can fetch temporary HTTPS media through the signed application route.
- Verify production ingress supports required video sizes/range fetching and clean up cancelled/orphaned uploads.

## Security And Public Readiness

See the [security report](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/security_best_practices_report.md). Priorities: dependency patches, clip ownership, OAuth session binding, server-only Instagram credentials and bounded processing/storage/API spend.

Before inviting customers:

- Verify deployed Supabase table/column grants, RLS, views/functions with anonymous and two independent users, including entitlements, accounts and jobs.
- Verify real TLS/headers, scoped IAM, secret rotation, upload controls, redacted logs and alerting.
- Replace placeholder privacy/support text with truthful retention/processing/deletion details. Add disconnect/revoke and account deletion. Obtain appropriate legal review for served markets.
- Verify current Meta dashboard permissions/review/access requirements for non-role customers. Tester success does not establish public-customer access. Prepare permanent callback/privacy/deletion URLs and a reviewable consent-to-publish flow. Meta docs returned HTTP 429 during this review; this plan is not Meta approval.
- Confirm content/copyright terms, abuse reporting, suspension and billing/incident support responsibilities.
- Test backup restore, migration/deployment rollback and avoidance of duplicate/re-enabled jobs. Keep staging dispatch disabled unless a test-account post is explicitly authorized.

## Rollout Sequence

### Phase 1: Security Baseline

Resolve/retest High findings, replace custom authentication and add ownership/OAuth/RLS/resource tests. Keep changes scoped and preserve working features.

### Phase 2: Plans And Payments

Approve duration semantics/quotas. Implement server-owned entitlements, UI gates and verified billing lifecycle. Test direct API tampering and upgrades/downgrades while preserving local work.

### Phase 3: Staging And Durable Scheduling

Production-like HTTPS/container/worker/storage configuration, safe migrations, token lifecycle, monitoring and recovery. Test >24-hour schedules, browser closed, worker restart, concurrent claims, cancellation and missed-job policy without publishing old jobs.

### Phase 4: Controlled Beta Then Public Launch

Complete Meta/public-readiness gates. Test signup -> Free editing -> upgrade -> schedule -> publish -> cancel/downgrade. Start with a small group and monitored quotas/cost/failures before expanding registration.

## Decisions Needed

1. Short duration applies to all Free outputs or only auto-trim? Is exactly 10 seconds allowed?
2. Is immediate Instagram posting Free? Recommended: yes with a small bounded allowance; scheduling remains Pro-only.
3. Pro duration, posting/AI/storage/account/pending-job limits and scheduling horizon, informed by cost measurements. No unlimited promise.
4. Business country/currency/provider, price and payment grace/cancellation/refund/support rules.
5. Domain, hosting budget and responsibility for worker alerts/backups/incidents.

Begin implementation with approved security fixes, then entitlements and production staging. This planning review has not changed application code, environment, database or scheduler behavior.

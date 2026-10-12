# Prelaunch Security Review

Date: 2026-10-11. Application: ClipMemeEditor.

## Executive Summary

**Recommendation: do not open public registration or paid production access yet.** Fix the high-priority findings, then verify the deployed configuration and security regressions in staging. No evidence of an actual compromise was established.

This is a source/configuration review and dependency audit, not a penetration test or security certification. The initial review changed only documents. The approved remediation below subsequently changed application code and dependencies, without changing environment variables or database contents.

## Remediation Status

Approved security remediation started on 2026-10-11. The original findings below document the pre-fix state; their original line references may have moved.

| Finding | Current Status |
| --- | --- |
| SBP-001 | Production npm audit now reports zero advisories after Next.js 16.3.8 and compatible transitive patches. React/React DOM aligned to 19.3.0 because existing React-Konva 19.3.0 requires it. Full development audit still reports 25 affected packages (20 moderate, 5 high); no critical remains. Do not force-downgrade tooling to satisfy automated suggestions. |
| SBP-002 | Fixed: owner checks, cryptographic IDs, collision-safe temporary names, no-store responses and authenticated fallback loading. Synthetic two-user/expiry tests pass. |
| SBP-003 | Core account-linking CSRF fixed: ten-minute signed state, hashed HttpOnly browser binding, verified callback cookie-session identity and callback cookie consumption. Wrong-host connect requests receive an actionable error. Durable atomic server-side nonce consumption across replicas remains a production hardening item; cookie clearing alone is not a durable replay ledger. |
| SBP-004 | Non-destructive token-column grant migration prepared, NOT applied to Supabase. After applying, ordinary clients can read only their non-secret account columns. Encrypted private token storage/key management and live grant verification remain outstanding. |
| SBP-005 | Partial: production atomic per-account rate-limit RPC prepared/wired, local bounded counters, native FFmpeg concurrency/deadlines/diagnostics, downloader ceilings and timeouts, multipart aggregate caps, transcription timeout, and Instagram media magic checks. SQL migration must be applied before production. Streaming/direct-upload finalization, decoded-video checks, aggregate upload-memory/tmp quotas, signup/IP abuse defenses and isolated native workers remain launch gates. |
| SBP-006 | Replaced hardcoded JWT verifier with Supabase getClaims plus explicit issuer/audience/role/subject/expiry/nbf checks. Correct cookie serialization preserves refresh/deletion attributes. Public signing-key fetch verified over trusted TLS; real key-rotation/revocation exercise remains a staging check. |
| SBP-007 | New source history scoped by user with compound keys, per-user eviction and editor reset on signout/account change. Legacy ownerless source records preserved in the old store, not auto-assigned or displayed. Saved export history remains unchanged. |
| SBP-008 | Credential messages no longer carry JWTs; isolated bridge fetches verified session endpoint. Signout clears extension credential and stale refreshes cannot restore it. Exact message origin checks added. Dedicated short-lived upload-only credentials remain future hardening. Reload extension to activate updated bridge scripts. |
| SBP-009 | Added and runtime-verified nosniff, DENY framing, no-referrer and restrictive frame/object/base CSP without disrupting WASM/editor. Full nonce/hash script CSP and deployed-edge verification remain outstanding. |
| SBP-010 | Removed development certificate bypass. R2 read-only metadata request succeeds with certificate verification and system CAs. |
| SBP-011 | Runtime output ignored and unsafe auth URL logging removed with old verifier. Edge/APM log redaction and historical secret scan remain outstanding. |

### Required Database Step

Run [security-hardening.sql](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/supabase/security-hardening.sql) in Supabase SQL Editor after the existing Instagram schema. It revokes client token access, preserves service-role publishing access and account/post rows, and creates the server-only atomic rate-limit RPC. It does not publish, cancel, reschedule or modify old posts. Production request admission deliberately returns 503 if this migration is missing/unavailable; development uses local counters.

No database connector was configured, so this migration was not executed or live-verified. Do not treat the prepared SQL as an applied database fix.

### Verification

- 18 suites / **123 tests passed**; TypeScript check passed.
- Production build passed on Next.js 16.3.8. Existing middleware-to-proxy deprecation and framework Edge-runtime warnings remain.
- Desktop/mobile Playwright workflow passed: local save without upload, reload/history, past-time rejection, calendar cards/previews, scheduling-disabled state, downloads, and rendered post-now workflow. All Instagram browser actions were intercepted; no real publishing was used for verification.
- App restarted on **port 3000**, retaining the existing scheduler configuration and old-post cutoff. No environment edits, port changes or old-post reactivation.
- OAuth connect must start on the same hostname as the configured callback. For tunnel testing, open/sign in on that tunnel URL before connecting Instagram. Existing stored connections are unaffected.

**Public launch remains blocked** by database migration/verification, remaining resource-isolation and token-vault work, dev-tool advisories, and the production readiness checks in the plan.

## Scope And Verification

- Reviewed API authentication/authorization, Instagram OAuth/publishing, Supabase SQL policies, uploads/native processing, extension credentials, local history and deployment configuration.
- Regression baseline: **11 suites / 79 tests passed** with `npm test -- --runInBand`. This is not proof of authorization or billing security coverage.
- Production dependency audit completed with current npm and Node's system CA store: **3 affected packages, 1 critical and 2 high**, aggregating multiple advisories. Exit code 1 represented advisories, not execution failure.
- Live Supabase grants/policies, R2 lifecycle/IAM, production edge controls, native binary advisories and historical secret exposure were not independently verified. No credentials or private media were extracted.
- An upstream advisory does not prove its vulnerable feature is reachable in this app.

## Prioritized Findings

| ID | Priority | Finding | Confidence |
| --- | --- | --- | --- |
| SBP-001 | High; upstream Critical | Vulnerable production dependencies | Audit confirmed; reachability conditional |
| SBP-002 | High | Legacy clip retrieval lacks ownership checks | Source confirmed |
| SBP-003 | High | OAuth state is not bound to initiating session | Source confirmed; attack not exercised |
| SBP-004 | High | Instagram tokens share a browser-readable account table | SQL confirmed; deployed grants unknown |
| SBP-005 | High | Expensive operations lack shared abuse/cost controls | App code confirmed; edge controls unknown |
| SBP-006 | Medium | Custom JWT verifier hardcodes a key and omits claim checks | Source confirmed |
| SBP-007 | Medium | Source history is shared across app accounts on one browser | Source confirmed |
| SBP-008 | Medium | Extension retains broad session credentials after logout | Source confirmed |
| SBP-009 | Medium | Browser security headers incomplete in app config | Edge configuration unknown |
| SBP-010 | Medium in development | R2 development client disables TLS verification | Not active under production NODE_ENV |
| SBP-011 | Low | Runtime logs can retain sensitive URL parameters | No public leak established |

## High-Priority Findings

### SBP-001: Vulnerable Production Dependencies

**Locations:** [Next lock entry](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/package-lock.json:9380), [sharp](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/package-lock.json:10504), [source-map-js](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/package-lock.json:10693).

**Evidence:** Next.js 16.3.5, sharp 0.35.4 and source-map-js 1.2.1 were flagged by the production npm audit. Next.js has multiple advisories including Critical GHSA-vcvr-r3jv-pc5j and High GHSA-cjq9-62q9-8jv4, plus cache/development disclosure issues.

**Impact/uncertainty:** The critical Next.js issue requires attacker-controlled SVG values passed to Node.js next/og ImageResponse. No next/og/ImageResponse usage was found in reviewed app sources; RCE in this app is **not confirmed**. sharp exploitation depends on SVG processing and Linux runtime conditions. source-map-js needs an attacker-controlled source-map processing path. Verify production reachability, but patch the affected packages before release.

**Fix:** Upgrade to maintained versions outside every affected range; align Next.js/eslint-config-next and intentionally update the lockfile. The audited issues require Next.js >=16.3.8, sharp >=0.35.5 and source-map-js >=1.2.2; recheck advisories when selecting releases. Avoid unreviewed audit-fix --force.

**Retest:** Production/full audits, clean install/build, unit tests, editor/WASM/OAuth/extension smoke checks, and Linux container/native ffmpeg/ffprobe/yt-dlp scanning.

**Sources:** [Next.js maintainer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), [sharp maintainer advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

### SBP-002: Legacy Clip Retrieval Lacks Ownership Checks

**Locations:** [shared store](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/receive-clip.ts:19), [ID creation](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/receive-clip.ts:86), [GET retrieval](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/receive-clip.ts:94).

**Evidence:** The shared map stores only buffer/content type. GET authenticates but returns any supplied clip ID without matching an owner. IDs combine a timestamp and short Math.random suffix.

**Impact:** Any authenticated user obtaining another clip ID can retrieve that recording while it remains in memory. The newer user-scoped R2 route does not protect this separate reachable endpoint. Unpredictable IDs cannot replace authorization.

**Fix:** Remove this legacy route if confirmed unused; otherwise add ownerId and access checks, cryptographic IDs, collision-safe temporary paths and resource caps.

**Retest:** Synthetic clip created by A: A succeeds, B gets 403/404, anonymous access fails, expiry works. Do not test with real private clips.

### SBP-003: OAuth State Lacks Session Binding, Expiry And One-Time Use

**Locations:** [state generation](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/instagram.ts:64), [validation](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/instagram.ts:93), [callback association](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/instagram/callback.ts:21).

**Evidence:** HMAC protects nonce/userId from modification, but there is no state expiry, persisted/consumed nonce or comparison with the initiating browser/session at callback.

**Impact:** An attacker with an app account can generate a valid authorization URL and persuade a victim to authorize Instagram through it. The callback can associate the victim's Instagram with the attacker's app account. This requires victim interaction and was not exercised against Meta. Single-use OAuth codes do not fix unbound state.

**Fix:** Short-lived one-time nonce bound to authenticated user and browser/session; secure HttpOnly SameSite=Lax binding cookie or equivalent server session; atomic nonce consumption. Require a configured HTTPS callback in production and separate state signing secret.

**Retest:** Reject wrong-session, expired/replayed/tampered/malformed state, missing binding cookie and logout-during-flow; normal reconnect succeeds.

### SBP-004: Instagram Tokens Are Not Server-Only At The Database Boundary

**Locations:** [token column](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/supabase/instagram-posting.sql:10), [SELECT policy](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/supabase/instagram-posting.sql:43), [raw token persistence](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/instagram.ts:246).

**Evidence:** Raw access_token lives in public.social_accounts. The supplied SELECT policy allows each user's entire row, with no column restriction/grant revocation. RLS protects rows, not token columns. Sanitizing the account API response does not block direct Supabase Data API reads.

**Impact/uncertainty:** Under ordinary authenticated SELECT grants, clients can retrieve their long-lived publishing token. XSS or compromised clients could extract authority lasting beyond the app session. This is not cross-user row access. Check actual deployed grants before claiming the token is currently retrievable.

**Fix:** Encrypted credentials in a server-only private schema/table excluded from client/Data API access; expose non-secret account summaries only. Keep encryption keys outside DB, define revocation/rotation and least-privilege service access. Verify views/functions/grants as well as RLS.

**Retest:** Anonymous/ordinary users cannot select token columns/tables/views; A cannot access B's account/posts; account summaries and server publishing still work. Use synthetic tokens in staging.

### SBP-005: Authenticated Resource Abuse And Unbounded Spend

**Locations:** [buffered Instagram upload](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/instagram/upload.ts:16), [merge](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/merge.ts:25), [stitch](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/stitch.ts:25), [transcription](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/transcribe.ts:38), [downloader cache](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/ytdl.ts:32).

**Evidence:** Some endpoints buffer up to 500 MB. Instagram uploads trust declared video MIME without validated contents/duration. Reviewed APIs lack shared per-user quotas/rate/concurrency limits. Native tasks lack consistent process deadlines and bounded stderr. A downloader wait timeout is not a process lifetime/output cap/cache eviction policy. AI transcription incurs provider cost without an app quota.

**Impact:** Valid free/low-cost accounts can exhaust memory, CPU, disk, storage and paid API budgets. Concurrent requests amplify per-request ceilings. Edge controls were not verified.

**Fix:** Atomic shared per-user/IP admission, cost/usage quotas and concurrency bounds; validated byte/format/duration limits; deadlines/kill/abort cleanup and bounded diagnostics. Isolate untrusted processing in non-root workers with CPU/memory/tmp/network restrictions. Validate scoped direct uploads in a finalize step before use. Enforce server-side plan limits on hosted operations.

**Retest:** Small synthetic staging files verify invalid-input rejection, 429 on exhausted quotas, parallel-request bounds, process cancellation and cleanup. Do not load-test the working app or real paid providers.

## Medium-Priority Findings

### SBP-006: Custom JWT Verifier Omits Claim Checks And Key Rotation

**Location:** [hardcoded JWK and verifier](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/supabase-server.ts:30).

**Evidence:** Real ECDSA verification trusts a fixed public key and checks exp and truthy sub only. It does not bind issuer, audience, authenticated role, expected subject format or nbf, or refresh keys using kid.

**Impact:** Key rotation can break authenticated APIs; retired/compromised keys remain trusted in code. Claim confusion is possible with otherwise valid signed tokens. This is not alg:none, a leaked private key or proof of arbitrary token forgery.

**Fix:** Configured-project Supabase verification or a maintained JWT library with project JWKS and explicit accepted claims. Define revocation for sensitive actions. [Supabase getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims) verifies against project JWKS.

**Retest:** Reject wrong issuer/audience/role, malformed subject, future nbf, expired/bad signatures; legitimate key rotation succeeds. Document/test logout and revocation semantics.

### SBP-007: Source History Crosses App Account Changes On One Browser

**Locations:** [ownerless record](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/clip-db.ts:6), [unfiltered listing](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/clip-db.ts:71), [history load](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/components/ToolPanel/HistoryPanel.tsx:60), [logout](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/index.tsx:790).

**Evidence/impact:** Source IndexedDB records lack owner and list/get filters. Signout clears in-memory export history but does not establish isolation of source clips/current editor state. Another account using the same browser profile can see prior source history. This is same-device privacy exposure, not remote DB access. Saved exports already use account scoping; retain that pattern.

**Fix:** Scope source history/operations by owner, reset active editor media/object URLs/state on logout/account change, and safely migrate legacy ownerless records without silently assigning them to the next login. Local browser-profile/OS access is not an app-account security boundary.

**Retest:** A -> logout -> B sees no A clips/editor state; A returns to only A's history. Explain device/origin-local storage and lack of cloud backup.

### SBP-008: Extension Retains Broad App Credentials After Logout

**Locations:** [page token bridge](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/chrome-ext/editor-bridge-main.js:11), [null-token handling](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/chrome-ext/editor-bridge.js:9), [token broadcast](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/chrome-ext/background.js:3).

**Evidence/impact:** A full Supabase JWT is persisted in extension storage. Missing tokens are ignored instead of clearing the previous credential; only new values are broadcast. The extension can act as the previous account until token expiry, and a stolen JWT carries broad API authority. Same-window checks exist; wildcard targetOrigin alone does not prove remote exfiltration.

**Fix:** Clear/revoke credentials on logout/account change/expiry, including active tabs. Prefer short-lived upload-only credentials with audience/user/origin checks. Validate bridge schema and exact app origins. Do not redesign capture behavior during an authentication fix.

**Retest:** Logout prevents uploads as the old user; account switching uploads as the new user only; expired credentials fail closed. Regression-test Bilibili/video-only capture after extension changes.

### SBP-009: Browser Defense-In-Depth Headers Are Incomplete

**Location:** [Next headers](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/next.config.ts:14).

**Evidence/impact:** App config contains COOP/COEP but no CSP/frame-ancestors, nosniff or Referrer-Policy. Edge headers were not verified. This reduces defenses against script injection, clickjacking and referrer leakage; no exploitable XSS was established.

**Fix:** Inspect deployed responses, introduce compatible CSP report-only then enforce nonces/hashes, and configure frame-ancestors/nosniff/referrer policy and appropriate edge HTTPS/HSTS. Preserve WASM/blob/media/OAuth; avoid unjustified global unsafe-eval.

**Retest:** Browser violations and real response headers for editor/login/OAuth/previews; no public caching of authenticated account/schedule responses; signed-media caching does not unexpectedly outlive authorization.

### SBP-010: Development R2 Client Skips Certificate Verification

**Location:** [development HTTPS agent](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/r2.ts:7).

**Evidence/impact:** rejectUnauthorized:false is used outside production NODE_ENV. Interception can compromise real R2 credentials/media during development or an accidentally exposed development deployment. A correctly started production client does not use this agent.

**Fix:** Remove the bypass and configure trusted system/enterprise CAs. Use production build/start and separate development/staging secrets/buckets.

**Retest:** Trusted endpoints work without verification bypass; invalid certificates are rejected everywhere; public deployment is not next dev.

## Low-Priority Finding

### SBP-011: Sensitive URL Parameters Can Persist In Runtime Logs

**Locations:** [OAuth query handling](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/pages/api/instagram/callback.ts:18), [URL logging](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/lib/supabase-server.ts:44), [.gitignore](E:/Projects/vibecoding/Products/LiveMemeEditor/clipmeme/.gitignore).

**Evidence/impact:** Callback URLs contain code/state, and Next development request logs retain query strings. Runtime output has no dedicated ignore rule. Environment files are ignored and none were found in the tracked files inspected; this is not a historical secret scan. Logs can retain auth codes/signed media capabilities and accidentally enter shared artifacts. No public log leak was established.

**Fix/retest:** Redact code/state/access_token/sig/Authorization in application/edge/APM logs; use correlation IDs, restricted retention and ignored runtime output. Run historical secret scanning before publication. Public app IDs/public JWKs alone do not warrant credential rotation.

## Additional Release Gates

- **Entitlements:** The plan helper is unused; no billing implementation was found. Verify deployed profile/plan grants; clients must not self-grant Pro. This is a missing feature, not a proven current self-upgrade exploit.
- **Canonical origin:** Use configured production HTTPS origin instead of raw Host/x-forwarded-proto construction. Restrict immediate publishing to owned validated media if enforcing hosted quotas. Passing a URL to Meta is not application-server SSRF by itself.
- **Worker credential:** Server-only cron secret, independent from OAuth/media signing. Test invalid credentials without making a valid publish request.
- **Storage:** Verify R2 IAM/lifecycles; a code comment does not prove 24-hour deletion. Retain scheduled objects through the scheduling horizon/retry grace and clean up afterwards.
- **Recovery:** Durable leases/publish reconciliation, token expiry/refresh tracking, heartbeat alerts and cancellation. Preserve the old-post exclusion safeguard during migrations.
- **Public readiness:** Verify Meta dashboard access/review requirements for non-role customers, permanent OAuth/privacy/deletion URLs, support contact, account deletion/disconnect/token revocation. Meta docs returned HTTP 429, so dashboard-specific requirements were not independently certified.

## Remediation Order

1. Patch dependencies and fix clip ownership, OAuth binding and credential boundaries with isolated regression tests.
2. Replace custom JWT verification, bound resource costs, add server-side entitlements, and isolate history/extension credentials on logout.
3. Verify staging RLS/grants/IAM, TLS/headers, backups, billing webhooks and scheduler recovery.
4. Focused authenticated two-user security retest, then controlled beta. Resolve or explicitly mitigate release blockers before public launch.

The original review was read-only. Current applied fixes and remaining gates are recorded in Remediation Status above.

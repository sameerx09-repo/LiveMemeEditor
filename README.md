This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/pages/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

## Instagram posting and scheduling

Apply `supabase/instagram-posting.sql` in Supabase, then configure:

```bash
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=http://localhost:3000/api/instagram/callback
INSTAGRAM_STATE_SECRET=
INSTAGRAM_GRAPH_VERSION=v24.0
INSTAGRAM_CRON_SECRET=
```

The local app is pinned to port `3000`. The Instagram app needs content publishing permissions for a professional Instagram account. Direct posting uploads the browser-exported clip straight to private R2 storage after authenticated preparation/finalization. Instagram receives a fresh signed R2 download link, not a video streamed through this app. Local OAuth still needs a matching public callback URL in Meta.

The app launcher supports a built-in Instagram scheduler. It is disabled until `INSTAGRAM_SCHEDULER_ENABLED=true` is explicitly configured. Review overdue posts before enabling it: the worker will publish all due scheduled posts, including those missed before a restart. With this flag enabled, `npm run dev` and `npm start` launch the app and scheduler together. The scheduler checks the protected worker every 30 seconds and logs publishing successes and failures. If `INSTAGRAM_CRON_SECRET` is absent, the launcher generates a private credential shared with the server for that run. Keep the terminal, computer, and public tunnel running; closing the browser alone does not stop scheduling. The launcher uses the system certificate store on supported Node versions without disabling TLS checks.

For deployments that do not run this launcher (such as serverless hosting), configure an external scheduler to call `POST /api/instagram/run-due` with `Authorization: Bearer $INSTAGRAM_CRON_SECRET` at the selected cadence. Use one-minute checks when near-minute delivery is needed. A standalone local worker can also be started with `npm run instagram:scheduler` when the app already has the same configured secret and scheduling is explicitly enabled. Never expose this secret in client-side variables.

The Supabase production setup now defaults to hourly checks on India clock
boundaries, with an administrator-only configurator for 60, 30, 1, or other
clock-aligned minute intervals. Hourly checks intentionally delay off-hour posts
until the next tick. See DEPLOYMENT.md for setup and changing the interval. Worker
capacity is separately configurable with INSTAGRAM_SCHEDULER_BATCH_SIZE (production
default 10 concurrent posts across users). No production cron is enabled by editing
these files.

The calendar and editor show scheduler status and reject new schedules while local publishing is disabled. Start local publishing through the app launcher, not `next dev` directly. For a separately managed worker, set `INSTAGRAM_SCHEDULER_MODE=external` and configure `INSTAGRAM_CRON_SECRET` in the app; this indicates external scheduling is configured, not that the external service is healthy. Posts more than one minute past their scheduled time are shown as overdue until publishing starts.

`INSTAGRAM_SCHEDULER_NOT_BEFORE` is a persistent UTC cutoff for future-only activation. Posts scheduled before that timestamp are excluded from the worker and displayed as Skipped, without deleting or changing their database rows. Keep this value across restarts so old posts cannot be published later. An invalid value blocks publishing.

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Save to History renders the current edit into IndexedDB, scoped to the signed-in account. It does not upload or download the video. Saved clips reload in History and Schedule; Download writes a selected clip to the chosen folder or browser downloads. Browser history belongs to the current site origin, so localhost and a tunnel URL have separate storage. Clearing site data removes local clips.

Post to Instagram asks for a caption, renders the current edit, saves it to History, then uploads and publishes that render. Scheduling uploads the chosen saved clip immediately so the browser can close afterward. The worker saves a durable storage reference and signs fresh media links when due; Instagram gets a one-hour private R2 download link. Existing signed scheduled references are refreshed too. The app and scheduler must remain available at publishing time, but Instagram media download no longer relies on a local tunnel. Keep INSTAGRAM_REDIRECT_URI updated for OAuth. No public R2 bucket is required.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.ts`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) instead of React pages.

This project uses [`next/font`](https://nextjs.org/docs/pages/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn-pages-router) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Deployment target: **https://instantmemeeditandpost.online**, from
https://github.com/sameerx09-repo/LiveMemeEditor.
See [DEPLOYMENT.md](DEPLOYMENT.md) for environment values, domain/Meta setup,
private direct storage uploads, production extension packaging and safe scheduler
activation. Preparation does not enable publishing or approve public launch.

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/pages/building-your-application/deploying) for more details.

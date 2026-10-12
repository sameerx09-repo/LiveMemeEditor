import Head from "next/head";

const UPDATED_AT = "October 8, 2026";

export default function PrivacyPage() {
  return (
    <>
      <Head>
        <title>Privacy Policy | ClipMemeEditor</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="min-h-screen bg-[#0f0f0f] text-[#e8e8e8] px-6 py-10">
        <article className="mx-auto max-w-3xl space-y-8">
          <header className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-wider text-[#ff4444]">ClipMemeEditor</p>
            <h1 className="text-4xl font-black tracking-tight text-white">Privacy Policy</h1>
            <p className="text-sm text-[#888]">Last updated: {UPDATED_AT}</p>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white">Overview</h2>
            <p>
              ClipMemeEditor helps users create, export, post, and schedule short video clips. This policy explains
              what information we collect, how we use it, and how users can request deletion of their data.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white">Information We Collect</h2>
            <p>
              When you sign in, we use your account email and user ID to authenticate your access. When you connect
              Instagram, we store the Instagram professional account ID, username, Facebook Page ID when available,
              and an access token provided by Meta so that you can publish or schedule posts.
            </p>
            <p>
              When you export or post a clip, we may temporarily store the exported media URL, caption, scheduled
              time, publishing status, and related Instagram publishing IDs.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white">How We Use Information</h2>
            <p>
              We use your information to authenticate your account, connect your Instagram professional account,
              upload exported clips, publish posts you explicitly request, and run scheduled posts at the selected
              time. We do not sell your personal information.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white">Instagram and Meta Data</h2>
            <p>
              ClipMemeEditor requests Instagram permissions only to identify your connected professional account and
              publish media that you choose to post or schedule. We do not post automatically without your action or
              a schedule you create.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white">Data Storage and Sharing</h2>
            <p>
              Clip and scheduling data may be stored in Supabase and Cloudflare R2. We share data with Meta only as
              needed to publish Instagram media you request. We do not share your data with advertisers or data brokers.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white">Data Deletion</h2>
            <p>
              You can request deletion of your ClipMemeEditor account data, connected Instagram account data, saved
              media references, and scheduled post records by contacting the app owner. Once verified, we will delete
              the requested data unless we are required to retain it by law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-white">Contact</h2>
            <p>
              For privacy or data deletion requests, contact the ClipMemeEditor app owner at the support email listed
              in the Meta Developer app dashboard.
            </p>
          </section>
        </article>
      </main>
    </>
  );
}

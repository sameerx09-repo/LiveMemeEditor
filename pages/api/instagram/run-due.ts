import type { NextApiRequest, NextApiResponse } from "next";
import { createAdminClient, getScheduledInstagramAccount, publishInstagramMedia } from "@/lib/instagram";
import { getAccountProfile, INSTAGRAM_PRO_REQUIRED } from "@/lib/membership-server";
import { refreshScheduledMediaUrl } from "@/lib/instagram-scheduled-media";
import { getInstagramSchedulerBatchSize, getInstagramSchedulerCutoff, getInstagramSchedulerStatus } from "@/lib/instagram-scheduler-status";

export const config = { maxDuration: 300 };

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") return err.message;
  return "Instagram publish failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).end();
  const secret = process.env.INSTAGRAM_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (process.env.VERCEL && !getInstagramSchedulerStatus().enabled) return res.status(503).json({ error: "Production scheduler is not activated with a valid cutoff" });
    res.setHeader?.("Cache-Control", "no-store");
    const batchSize = getInstagramSchedulerBatchSize();
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const cutoff = getInstagramSchedulerCutoff();
    let query = admin
      .from("instagram_posts")
      .select("id,user_id,social_account_id,caption,media_url,scheduled_at")
      .eq("status", "scheduled")
      .lte("scheduled_at", now);
    if (cutoff) query = query.gte("scheduled_at", cutoff);
    const { data: posts, error } = await query
      .order("scheduled_at", { ascending: true })
      .limit(batchSize);

    if (error) throw error;
    if (posts?.length) console.info(`[Instagram worker] Found ${posts.length} due post(s) at ${now}`);

    // Bound parallel work so same-slot posts need not wait for the next cron tick.
    const outcomes = await Promise.all((posts ?? []).slice(0, batchSize).map(async post => {
      const scheduledTime = new Date(post.scheduled_at).getTime();
      if (!Number.isFinite(scheduledTime) || scheduledTime > new Date(now).getTime() ||
          (cutoff && scheduledTime < new Date(cutoff).getTime())) return null;
      let claimedByWorker = false;
      let publishedMediaId: string | null = null;
      try {
        const { data: claimed, error: claimError } = await admin.from("instagram_posts")
          .update({ status: "publishing", updated_at: new Date().toISOString() })
          .eq("id", post.id).eq("status", "scheduled")
          .eq("scheduled_at", post.scheduled_at).select("id").maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) return null;
        claimedByWorker = true;
        if ((await getAccountProfile(post.user_id)).plan !== "pro") throw new Error(INSTAGRAM_PRO_REQUIRED);
        // The initial due-post snapshot may predate a disconnect or account change.
        const account = await getScheduledInstagramAccount(post.user_id, post.social_account_id);
        if (!account) throw new Error("Instagram disconnected. Create a new schedule after reconnecting.");
        console.info(`[Instagram worker] Publishing ${post.id}`);
        const published = await publishInstagramMedia({
          accessToken: account.accessToken,
          igUserId: account.igUserId,
          mediaUrl: refreshScheduledMediaUrl(post.media_url, post.user_id),
          caption: post.caption || "",
          mediaType: "REELS",
        });
        publishedMediaId = published.mediaId;
        const { error: saveError } = await admin.from("instagram_posts").update({
          status: "published",
          instagram_creation_id: published.creationId,
          instagram_media_id: published.mediaId,
          published_at: new Date().toISOString(),
          error: null,
          updated_at: new Date().toISOString(),
        }).eq("id", post.id);
        if (saveError) throw saveError;
        console.info(`[Instagram worker] Published ${post.id}: ${published.mediaId}`);
        return { id: post.id, ok: true, mediaId: published.mediaId };
      } catch (err: unknown) {
        console.error(`[Instagram worker] ${post.id}: ${errorMessage(err)}`);
        // A completed Instagram publish must not become a retryable failed post.
        if (publishedMediaId) {
          return { id: post.id, ok: false, mediaId: publishedMediaId, error: "Published on Instagram, but saving the result failed. Check Instagram before retrying." };
        }
        if (claimedByWorker) {
          try {
            const { error: saveError } = await admin.from("instagram_posts").update({
              status: "failed",
              error: errorMessage(err),
              updated_at: new Date().toISOString(),
            }).eq("id", post.id);
            if (saveError) throw saveError;
          } catch (saveError: unknown) {
            console.error(`[Instagram worker] Could not save failure for ${post.id}: ${errorMessage(saveError)}`);
          }
        }
        return { id: post.id, ok: false, error: errorMessage(err) };
      }
    }));
    const results = outcomes.filter(result => result !== null);
    if ((posts?.length ?? 0) >= batchSize) console.warn(`[Instagram worker] Batch limit ${batchSize} reached; additional due posts may wait for the next cron run`);

    res.status(200).json({ ok: true, results });
  } catch (err: unknown) {
    console.error(`[Instagram worker] Run failed: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
}

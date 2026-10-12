import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { createAdminClient, getDefaultInstagramAccount, getRequestBaseUrl } from "@/lib/instagram";
import { createScheduledMediaReference, refreshScheduledMediaUrl } from "@/lib/instagram-scheduled-media";
import { getInstagramSchedulerStatus } from "@/lib/instagram-scheduler-status";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Instagram schedule failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method === "POST" && !await requireInstagramPro(user.id, res)) return;
  if (req.method === "POST" && !await checkApiRateLimit(user.id, "schedule", res)) return;

  try {
    const scheduler = getInstagramSchedulerStatus();
    if (req.method === "POST" && !scheduler.enabled) return res.status(503).json({ error: scheduler.message });
    const admin = createAdminClient();

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("instagram_posts")
        .select("id,caption,media_url,scheduled_at,status,error,instagram_media_id,created_at")
        .eq("user_id", user.id)
        .order("scheduled_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ scheduler, posts: (data ?? []).map(post => {
        try { return { ...post, preview_url: refreshScheduledMediaUrl(post.media_url, user.id, getRequestBaseUrl(req)) }; }
        catch { return { ...post, preview_url: null }; }
      }) });
    }

    const { mediaUrl, caption, scheduledAt, igUserId } = req.body || {};
    if (!mediaUrl || typeof mediaUrl !== "string") return res.status(400).json({ error: "Missing mediaUrl" });
    if (!scheduledAt || typeof scheduledAt !== "string") return res.status(400).json({ error: "Missing scheduledAt" });

    const scheduleTime = new Date(scheduledAt);
    if (!Number.isFinite(scheduleTime.getTime())) return res.status(400).json({ error: "Invalid scheduledAt" });
    if (scheduleTime.getTime() <= Date.now()) return res.status(400).json({ error: "Choose a future schedule time" });
    let mediaReference: string;
    try { mediaReference = createScheduledMediaReference(mediaUrl, user.id, getRequestBaseUrl(req)); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid scheduled media" }); }

    const account = await getDefaultInstagramAccount(user.id);
    if (!account) return res.status(409).json({ error: "Connect Instagram first" });
    if (typeof igUserId !== "string" || igUserId !== account.igUserId) {
      return res.status(409).json({ error: "Instagram connection changed. Refresh and confirm the account before scheduling." });
    }

    const { data, error } = await admin
      .from("instagram_posts")
      .insert({
        user_id: user.id,
        social_account_id: account.id,
        media_url: mediaReference,
        caption: typeof caption === "string" ? caption : "",
        scheduled_at: scheduleTime.toISOString(),
        status: "scheduled",
      })
      .select("id,scheduled_at,status")
      .single();

    if (error) throw error;
    res.status(200).json({ ok: true, post: data });
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

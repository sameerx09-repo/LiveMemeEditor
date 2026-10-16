import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { createAdminClient, getRequestBaseUrl } from "@/lib/instagram";
import { refreshScheduledMediaUrl } from "@/lib/instagram-scheduled-media";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { validPostId } from "@/lib/manual-posts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["GET", "PATCH", "DELETE"].includes(req.method || "")) return res.status(405).end();
  const user = await requireAuth(req, res); if (!user) return;
  const id = req.query.id; if (!validPostId(id)) return res.status(400).json({ error: "Invalid post ID" });
  try {
    const admin = createAdminClient();
    const { data: post, error } = await admin.from("instagram_manual_posts").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!post) return res.status(404).json({ error: "Post not found in this account" });
    if (req.method === "GET") return res.status(200).json({ post: { id: post.id, name: post.name, caption: post.caption, audio_url: post.audio_url,
      scheduled_at: post.scheduled_at, status: post.status, error: post.error, email_sent_at: post.email_sent_at,target_username:post.target_username,
      preview_url: refreshScheduledMediaUrl(post.media_url, user.id, getRequestBaseUrl(req)) } });
    if (!await checkApiRateLimit(user.id, "schedule", res)) return;
    if (["notifying", "completed"].includes(post.status)) return res.status(409).json({ error: "This post is sending a reminder or is already marked done. Refresh and try again." });
    const { expectedScheduledAt, scheduledAt, action } = req.body || {};
    if (typeof expectedScheduledAt !== "string" || Date.parse(expectedScheduledAt) !== Date.parse(post.scheduled_at)) return res.status(409).json({ error: "Schedule changed. Refresh and try again." });
    if (req.method === "DELETE") {
      const result = await admin.from("instagram_manual_posts").delete().eq("id", id).eq("user_id", user.id).eq("status", post.status).eq("scheduled_at", post.scheduled_at).select("id").maybeSingle();
      if (result.error) throw result.error;
      return result.data ? res.status(200).json({ ok: true }) : res.status(409).json({ error: "Schedule changed. Refresh and try again." });
    }
    let changes;
    if (action === "complete") {
      if (Date.parse(post.scheduled_at) > Date.now()) return res.status(409).json({ error: "This post is not due yet" });
      changes = { status: "completed", completed_at: new Date().toISOString(), error: null };
    } else {
      if (!await requireInstagramPro(user.id, res)) return;
      if (typeof scheduledAt !== "string" || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) return res.status(400).json({ error: "Choose a future schedule time" });
      changes = { scheduled_at: new Date(scheduledAt).toISOString(), status: "scheduled", attempts: 0, email_sent_at: null,
        next_attempt_at: new Date().toISOString(), error: null, lease_id: null, lease_until: null };
    }
    const result = await admin.from("instagram_manual_posts").update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", user.id).eq("status", post.status).eq("scheduled_at", post.scheduled_at).select("id,scheduled_at,status").maybeSingle();
    if (result.error) throw result.error;
    return result.data ? res.status(200).json({ ok: true, post: result.data }) : res.status(409).json({ error: "Schedule changed. Refresh and try again." });
  } catch { return res.status(503).json({ error: "Could not load or change this manual post" }); }
}

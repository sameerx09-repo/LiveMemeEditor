import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { createAdminClient, getScheduledInstagramAccount } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "PATCH" && req.method !== "DELETE") {
    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).end();
  }
  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method === "PATCH" && !await requireInstagramPro(user.id, res)) return;
  if (!await checkApiRateLimit(user.id, "schedule", res)) return;

  const id = req.query.id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: "Invalid schedule ID" });
  }
  const { expectedScheduledAt, scheduledAt } = req.body || {};
  if (typeof expectedScheduledAt !== "string" || !Number.isFinite(Date.parse(expectedScheduledAt))) {
    return res.status(400).json({ error: "Refresh the calendar before changing this schedule" });
  }
  const newTime = typeof scheduledAt === "string" ? new Date(scheduledAt) : null;
  if (req.method === "PATCH" && (!newTime || !Number.isFinite(newTime.getTime()) || newTime.getTime() <= Date.now())) {
    return res.status(400).json({ error: "Choose a future schedule time" });
  }

  try {
    const admin = createAdminClient();
    const { data: post, error: readError } = await admin.from("instagram_posts")
      .select("id,status,scheduled_at,social_account_id")
      .eq("id", id).eq("user_id", user.id).maybeSingle();
    if (readError) throw readError;
    if (!post) return res.status(404).json({ error: "Schedule not found" });
    if (Date.parse(post.scheduled_at) !== Date.parse(expectedScheduledAt)) {
      return res.status(409).json({ error: "This schedule changed. Refresh the calendar and try again." });
    }
    if (post.status !== "scheduled" && !(req.method === "DELETE" && post.status === "failed")) {
      return res.status(409).json({ error: "This post is no longer queued. Publishing or published posts cannot be changed." });
    }

    if (req.method === "DELETE") {
      // A concurrent worker claim or edit must win over a stale delete request.
      const { data, error } = await admin.from("instagram_posts").delete()
        .eq("id", id).eq("user_id", user.id).eq("status", post.status)
        .eq("scheduled_at", post.scheduled_at).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return res.status(409).json({ error: "This schedule changed or started publishing. Refresh the calendar." });
      return res.status(200).json({ ok: true, id: data.id });
    }

    const account = await getScheduledInstagramAccount(user.id, post.social_account_id);
    if (!account) return res.status(409).json({ error: "The original Instagram account is disconnected. Create a new schedule after reconnecting." });
    if (newTime!.getTime() <= Date.now()) return res.status(400).json({ error: "Choose a future schedule time" });
    const { data, error } = await admin.from("instagram_posts")
      .update({ scheduled_at: newTime!.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", user.id).eq("status", "scheduled")
      .eq("scheduled_at", post.scheduled_at).select("id,scheduled_at,status").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "This schedule changed or started publishing. Refresh the calendar." });
    return res.status(200).json({ ok: true, post: data });
  } catch {
    return res.status(503).json({ error: "Could not change this schedule. Refresh the calendar and try again." });
  }
}

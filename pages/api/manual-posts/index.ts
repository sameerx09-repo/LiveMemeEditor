import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { createAdminClient, getRequestBaseUrl } from "@/lib/instagram";
import { createScheduledMediaReference, refreshScheduledMediaUrl } from "@/lib/instagram-scheduled-media";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { manualReminderConfig, validateAudioUrl } from "@/lib/manual-posts";
import { validPostId } from "@/lib/manual-posts";
import { selectedInstagramAccounts } from "@/lib/instagram-batch";
import { manualHandles } from "@/lib/instagram-destinations";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["GET", "POST"].includes(req.method || "")) return res.status(405).end();
  const user = await requireAuth(req, res); if (!user) return;
  const settings = manualReminderConfig();
  try {
    const admin = createAdminClient();
    if (req.method === "GET") {
      const { data, error } = await admin.from("instagram_manual_posts").select("*")
        .eq("user_id", user.id).order("scheduled_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return res.status(200).json({ reminders: { enabled: settings.enabled, message: settings.message }, posts: (data || []).map(post => ({
        id:post.id,name:post.name,caption:post.caption,audio_url:post.audio_url,scheduled_at:post.scheduled_at,status:post.status,error:post.error,
        email_sent_at:post.email_sent_at,completed_at:post.completed_at,target_username:post.target_username,group_id:post.group_id,
        delivery_mode: "manual", preview_url: refreshScheduledMediaUrl(post.media_url, user.id, getRequestBaseUrl(req)),
      })) });
    }
    if (!await requireInstagramPro(user.id, res) || !await checkApiRateLimit(user.id, "schedule", res)) return;
    if (!settings.enabled) return res.status(503).json({ error: settings.message });
    if (req.body?.emailReminder !== true) return res.status(400).json({ error: "Confirm the email reminder before scheduling" });
    const { mediaUrl, caption = "", name = "Instagram reel", audioUrl = "", scheduledAt } = req.body || {};
    if (typeof scheduledAt !== "string" || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) return res.status(400).json({ error: "Choose a future schedule time" });
    if (typeof caption !== "string" || caption.length > 2200 || typeof name !== "string" || name.length > 200 || typeof mediaUrl !== "string") return res.status(400).json({ error: "Invalid clip details" });
    let audio: string, reference: string;
    try { audio = validateAudioUrl(audioUrl); reference = createScheduledMediaReference(mediaUrl, user.id, getRequestBaseUrl(req)); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid media" }); }
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(user.id);
    if (accountError || !account.user?.email_confirmed_at || !account.user.email) return res.status(409).json({ error: "A confirmed account email is required for reminders" });
    if(req.body.accountIds!==undefined || req.body.handles!==undefined) {
      try {
        if(!validPostId(req.body.requestId))throw new Error("Invalid reminder request");
        if(req.body.accountIds?.length && req.body.handles?.length)throw new Error("Select connected accounts or enter other handles, not both");
        const handles=req.body.accountIds?.length ? (await selectedInstagramAccounts(user.id,req.body.accountIds)).map(account=>account.username) : manualHandles(req.body.handles);
        const rows=handles.map(handle=>({user_id:user.id,name,caption,audio_url:audio,media_url:reference,scheduled_at:new Date(scheduledAt).toISOString(),group_id:req.body.requestId,target_username:handle}));
        const result=await admin.from("instagram_manual_posts").insert(rows).select("id,scheduled_at,status,target_username,group_id");
        if(result.error?.code==="23505") return res.status(409).json({error:"This reminder request already exists. Check the calendar before creating another."});
        if(result.error)throw result.error;
        return res.status(200).json({ok:true,posts:result.data,post:result.data?.[0]});
      }catch(error){return res.status(409).json({error:error instanceof Error?error.message:"Could not schedule destinations"});}
    }
    const { data, error } = await admin.from("instagram_manual_posts").insert({ user_id: user.id, name, caption, audio_url: audio,
      media_url: reference, scheduled_at: new Date(scheduledAt).toISOString() }).select("id,scheduled_at,status").single();
    if (error) throw error;
    return res.status(200).json({ ok: true, post: data });
  } catch { return res.status(503).json({ error: "Manual reminders unavailable. Check setup and try again." }); }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { createAdminClient } from "@/lib/instagram";
import { manualReminderConfig, type ManualPost } from "@/lib/manual-posts";
import { resolveMembership } from "@/lib/membership";
import { sendPostingReminder } from "@/lib/reminder-email";

export const config = { maxDuration: 300 };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const secret = process.env.INSTAGRAM_CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
  const settings = manualReminderConfig();
  if (!settings.enabled) return res.status(503).json({ error: settings.message });
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("claim_manual_reminders", { p_not_before: settings.cutoff });
    if (error) throw error;
    let sent = 0;
    // Sequential sends respect provider rate limits and stay below the lease duration.
    for (const post of (data || []) as ManualPost[]) {
      let accepted = false;
      try {
        const { data: auth, error: authError } = await admin.auth.admin.getUserById(post.user_id);
        if (authError || !auth.user) throw new Error("Account unavailable");
        const user = auth.user;
        if (resolveMembership(user.app_metadata).plan !== "pro" || !user.email_confirmed_at || !user.email) {
          const result = await admin.from("instagram_manual_posts").update({ status: "failed", error: "An active Pro account with confirmed email is required", lease_id: null, lease_until: null, updated_at: new Date().toISOString() })
            .eq("id", post.id).eq("lease_id", post.lease_id);
          if (result.error) throw result.error;
          continue;
        }
        await sendPostingReminder(post, user.email);
        accepted = true;
        const result = await admin.from("instagram_manual_posts").update({ status: "awaiting_manual", email_sent_at: new Date().toISOString(),
          error: null, lease_id: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", post.id).eq("lease_id", post.lease_id);
        if (result.error) throw result.error;
        sent++;
      } catch {
        // If saving an accepted email failed, keep its lease for an idempotent recovery.
        if (accepted) continue;
        await admin.from("instagram_manual_posts").update({ status: post.attempts >= 3 ? "failed" : "scheduled",
          error: "Could not send email reminder", next_attempt_at: new Date(Date.now()+60000).toISOString(),
          lease_id: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", post.id).eq("lease_id", post.lease_id);
      }
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    return res.status(200).json({ ok: true, sent, claimed: data?.length || 0 });
  } catch { return res.status(503).json({ error: "Reminder worker unavailable" }); }
}

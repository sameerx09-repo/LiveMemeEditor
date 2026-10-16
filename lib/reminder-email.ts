import type { ManualPost } from "./manual-posts";
import { manualReminderConfig } from "./manual-posts";

export async function sendPostingReminder(post: ManualPost, recipient: string) {
  const config = manualReminderConfig();
  if (!config.enabled) throw new Error("Email reminders disabled");
  const link = `${config.origin}/manual-post/${post.id}`;
  // Stable payload and key across retries, including an ambiguous network timeout.
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json",
      "Idempotency-Key": `manual-post/${post.id}/${new Date(post.scheduled_at).getTime()}` },
    body: JSON.stringify({ from: process.env.REMINDER_EMAIL_FROM, to: [recipient],
      subject: "Your Reel is ready to finish in Instagram",
      text: `Your scheduled Reel is ready.${post.target_username ? `\nInstagram destination: @${post.target_username}` : ""}\n\nOpen your post to share the video, copy its caption and open the selected audio:\n${link}\n\nSign in to the account that scheduled this post. Posting is manual; this email does not mean it has been published.\n\nManage or delete this reminder from your calendar: ${config.origin}/?workspace=schedule`,
    }),
  });
  if (!response.ok) throw new Error("Email provider did not accept the reminder");
  const result = await response.json();
  if (typeof result.id !== "string" || !result.id) throw new Error("Email provider returned an invalid receipt");
  return result.id as string;
}

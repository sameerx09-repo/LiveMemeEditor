export type ManualPost = {
  id: string; user_id: string; name: string; caption: string; audio_url: string;
  media_url: string; scheduled_at: string; status: string; error: string | null;
  email_sent_at: string | null; completed_at: string | null;
  attempts: number; lease_id: string | null;
};

export function validPostId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function safeReturnTo(value: unknown) {
  return typeof value === "string" && /^\/manual-post\/[0-9a-f-]{36}$/i.test(value) ? value : "/";
}

export function validateAudioUrl(value: unknown) {
  if (value === "" || value === undefined) return "";
  if (typeof value !== "string" || value.length > 1000) throw new Error("Invalid Instagram audio link");
  const url = new URL(value);
  if (url.protocol !== "https:" || !["www.instagram.com", "instagram.com"].includes(url.hostname) ||
      url.username || url.password || url.port || !/^\/reels\/audio\/\d+\/?$/.test(url.pathname)) {
    throw new Error("Use an Instagram audio-page link: https://www.instagram.com/reels/audio/123/");
  }
  return `https://www.instagram.com${url.pathname}`;
}

export function manualReminderConfig() {
  let origin = "";
  try {
    const url = new URL(process.env.MANUAL_REMINDERS_BASE_URL || "");
    if (url.username || url.password || (url.protocol !== "https:" &&
        !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost"))) throw new Error();
    origin = url.origin;
  } catch { /* Invalid configuration disables reminders. */ }
  const cutoff = process.env.MANUAL_REMINDERS_NOT_BEFORE || "";
  const validCutoff = /^\d{4}-\d{2}-\d{2}T/.test(cutoff) && Number.isFinite(Date.parse(cutoff)) && Date.parse(cutoff) <= Date.now();
  const enabled = process.env.MANUAL_REMINDERS_ENABLED === "true" && !!origin && validCutoff &&
    !!process.env.RESEND_API_KEY && !!process.env.REMINDER_EMAIL_FROM && !!process.env.INSTAGRAM_CRON_SECRET;
  return { enabled, origin, cutoff, message: enabled ? "Email reminders configured" : "Email reminders are not configured or are switched off" };
}

export function manualPostLabel(status: string) {
  return ({ scheduled: "Email reminder scheduled", notifying: "Sending reminder", awaiting_manual: "Awaiting manual posting",
    completed: "Marked done by you", failed: "Reminder failed", skipped: "Reminder skipped" } as Record<string,string>)[status] || status;
}

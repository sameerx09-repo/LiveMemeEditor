import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { getDefaultInstagramAccount, publishInstagramMedia } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { createScheduledMediaReference } from "@/lib/instagram-scheduled-media";
import { getRequestBaseUrl } from "@/lib/instagram";

export const config = { maxDuration: 300 };

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Instagram publish failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;
  if (!await checkApiRateLimit(user.id, "publish", res)) return;
  res.setHeader("Cache-Control", "no-store");

  try {
    const { mediaUrl, caption } = req.body || {};
    if (!mediaUrl || typeof mediaUrl !== "string") {
      return res.status(400).json({ error: "Missing mediaUrl" });
    }
    try { createScheduledMediaReference(mediaUrl, user.id, getRequestBaseUrl(req)); }
    catch { return res.status(400).json({ error: "Upload this account's clip again before publishing" }); }

    const account = await getDefaultInstagramAccount(user.id);
    if (!account) return res.status(409).json({ error: "Connect Instagram first" });

    const published = await publishInstagramMedia({
      accessToken: account.accessToken,
      igUserId: account.igUserId,
      mediaUrl,
      caption: typeof caption === "string" ? caption : "",
      mediaType: "REELS",
    });

    res.status(200).json({ ok: true, ...published });
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

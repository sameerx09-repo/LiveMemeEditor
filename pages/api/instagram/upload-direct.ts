import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { getRequestBaseUrl, signInstagramMediaUrl } from "@/lib/instagram";
import { completeInstagramUpload, prepareInstagramUpload } from "@/lib/instagram-storage";

export const config = { api: { bodyParser: { sizeLimit: "8kb" } }, maxDuration: 30 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const user = await requireAuth(req, res);
  if (!user || !await requireInstagramPro(user.id, res)) return;
  if (!await checkApiRateLimit(user.id, "upload", res)) return;
  try {
    const { action, size, contentType, uploadToken } = req.body || {};
    if (action === "prepare") return res.status(200).json(await prepareInstagramUpload(user.id, size, contentType));
    if (action !== "complete" || typeof uploadToken !== "string") return res.status(400).json({ error: "Invalid upload action" });
    const uploaded = await completeInstagramUpload(user.id, uploadToken);
    return res.status(200).json({ mediaUrl: signInstagramMediaUrl(getRequestBaseUrl(req), uploaded.key) });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Video upload failed" });
  }
}

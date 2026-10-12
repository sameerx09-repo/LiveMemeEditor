import type { NextApiRequest, NextApiResponse } from "next";
import { getInstagramStorageDownloadUrl } from "@/lib/instagram-storage";
import { verifyInstagramMediaSignature } from "@/lib/instagram";

export const config = {
  api: { responseLimit: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();

  const { key, expires, sig } = req.query;
  if (typeof key !== "string" || typeof expires !== "string" || typeof sig !== "string") {
    return res.status(400).json({ error: "Missing media signature" });
  }

  if (!verifyInstagramMediaSignature(key, expires, sig)) {
    return res.status(403).json({ error: "Invalid media signature" });
  }

  res.setHeader("Cache-Control", "private, no-store");
  try { return res.redirect(307, await getInstagramStorageDownloadUrl(key, req.method === "HEAD")); }
  catch { return res.status(503).json({ error: "Media storage unavailable" }); }
}

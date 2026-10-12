import type { NextApiRequest, NextApiResponse } from "next";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "@/lib/supabase-server";
import type { Readable } from "stream";

export const config = {
  api: { responseLimit: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "DELETE") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing id" });
  // Validate: only accept 32-char lowercase hex IDs (crypto.randomBytes(16).toString('hex'))
  if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).json({ error: "Invalid clip id" });

  const r2 = getR2Client();
  if (!r2) return res.status(503).json({ error: "R2 not configured" });

  // User-scoped key — users can only access their own clips (H-3 ownership check)
  const key = `clips/${user.id}/${id}.webm`;

  if (req.method === "DELETE") {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return res.status(200).json({ ok: true });
  }

  if (process.env.VERCEL) {
    res.setHeader("Cache-Control", "private, no-store");
    return res.redirect(307, await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 300 }));
  }
  const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));

  res.setHeader("Content-Type", obj.ContentType || "video/webm");
  if (obj.ContentLength) res.setHeader("Content-Length", String(obj.ContentLength));
  res.setHeader("Cache-Control", "private, max-age=3600");

  (obj.Body as Readable).pipe(res);
}

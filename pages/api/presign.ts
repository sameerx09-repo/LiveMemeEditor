import type { NextApiRequest, NextApiResponse } from "next";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import { requireAuth } from "@/lib/supabase-server";
import { isValidWebM } from "@/lib/webm-utils";
import crypto from "crypto";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Wildcard CORS required: extension content scripts send from cross-origin pages (e.g. youtube.com).
  // Security comes from the Bearer token check, not the CORS origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();
  if (!await checkApiRateLimit(user.id, "upload", res)) return;
  res.setHeader("Cache-Control", "no-store");

  const r2 = getR2Client();
  if (!r2) {
    return res.status(503).json({ error: "R2 not configured" });
  }

  // Use 128-bit random ID — not guessable, no timestamp prefix
  const clipId = crypto.randomBytes(16).toString("hex");
  const key = `clips/${user.id}/${clipId}.webm`;

  if (req.method === "POST") {
    if (process.env.VERCEL) return res.status(413).json({ error: "Use GET /api/presign then upload directly to storage" });
    const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: "File too large (max 500 MB)" });
    }

    const key = `clips/${user.id}/${clipId}.webm`;
    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      req.on("data", (c: Buffer) => {
        received += c.length;
        if (received > MAX_UPLOAD_BYTES) {
          req.destroy();
          reject(new Error("Body exceeded size limit"));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    if (!isValidWebM(body)) {
      return res.status(415).json({
        error: "Only WebM video files are accepted",
        size: body.length,
        header: body.subarray(0, 4).toString("hex"),
      });
    }

    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "video/webm",
    }));
    return res.status(200).json({ clipId });
  }

  if (req.method !== "GET") return res.status(405).end();

  const uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: "video/webm" }),
    { expiresIn: 300 }
  );
  res.status(200).json({ uploadUrl, clipId });
}

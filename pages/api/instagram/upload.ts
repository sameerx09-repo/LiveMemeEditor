import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { getRequestBaseUrl, signInstagramMediaUrl, uploadInstagramMedia } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidWebM } from "@/lib/webm-utils";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Instagram media upload failed";
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["video/mp4", "video/webm"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;
  if (!await requireInstagramPro(user.id, res)) return;
  if (process.env.VERCEL) return res.status(413).json({ error: "Use the direct storage upload endpoint for hosted video uploads" });
  if (!await checkApiRateLimit(user.id, "upload", res)) return;
  res.setHeader("Cache-Control", "no-store");

  try {
    const contentType = (req.headers["content-type"] || "").split(";")[0];
    if (!ALLOWED_TYPES.has(contentType)) {
      return res.status(415).json({ error: "Upload an exported MP4 or WebM video" });
    }

    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      req.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) {
          req.destroy();
          reject(new Error("Upload exceeds 500 MB"));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    const valid = contentType === "video/webm" ? isValidWebM(body) :
      body.length >= 12 && body.toString("ascii", 4, 8) === "ftyp";
    if (!valid) return res.status(415).json({ error: "Invalid video file" });
    const uploaded = await uploadInstagramMedia(user.id, body, contentType);
    res.status(200).json({
      ...uploaded,
      mediaUrl: signInstagramMediaUrl(getRequestBaseUrl(req), uploaded.key),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

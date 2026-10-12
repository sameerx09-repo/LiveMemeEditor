import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { requireAuth } from "@/lib/supabase-server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { runMediaProcess } from "@/lib/media-process";

export const config = { api: { bodyParser: false, responseLimit: false } };

const FFMPEG = process.env.FFMPEG_PATH ?? (
  process.platform === "win32"
    ? "C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"
    : "ffmpeg"
);

const MAX_BODY_BYTES = 500 * 1024 * 1024; // 500 MB

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;
  if (process.env.VERCEL) return res.status(503).json({ error: "Use browser-side rendering on this deployment" });
  if (!await checkApiRateLimit(user.id, "process", res)) return;

  const chunks: Buffer[] = [];
  let received = 0;
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c: Buffer) => {
      received += c.length;
      if (received > MAX_BODY_BYTES) { req.destroy(); reject(new Error("Body too large")); return; }
      chunks.push(c);
    });
    req.on("end", resolve);
    req.on("error", reject);
  });

  const webmBuf = Buffer.concat(chunks);
  if (webmBuf.length === 0) return res.status(400).json({ error: "Empty body" });
  // Validate WebM magic bytes
  if (webmBuf.length < 4 || webmBuf[0] !== 0x1a || webmBuf[1] !== 0x45 || webmBuf[2] !== 0xdf || webmBuf[3] !== 0xa3) {
    return res.status(415).json({ error: "Only WebM video files are accepted" });
  }

  const id = `clipmeme-remux-${randomBytes(16).toString("hex")}`;
  const inFile = path.join(os.tmpdir(), `${id}.webm`);
  const outFile = path.join(os.tmpdir(), `${id}.mp4`);

  try {
    fs.writeFileSync(inFile, webmBuf);

    await runMediaProcess(FFMPEG, [
        "-y",
        "-i", inFile,
        "-c", "copy",       // stream copy — no re-encode, fast
        "-movflags", "+faststart",
        outFile,
      ]);

    const stat = fs.statSync(outFile);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Content-Disposition": "attachment",
    });
    const stream = fs.createReadStream(outFile);
    stream.pipe(res);
    stream.on("close", () => {
      fs.rmSync(inFile, { force: true });
      fs.rmSync(outFile, { force: true });
    });
  } catch (err: any) {
    fs.rmSync(inFile, { force: true });
    fs.rmSync(outFile, { force: true });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

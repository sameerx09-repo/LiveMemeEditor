import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";
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

// Authentication alone must not allow another user's clip to be retrieved.
const store = new Map<string, { ownerId: string; buf: Buffer; contentType: string }>();

function cors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  // Access-Control-Allow-Private-Network removed — do not expose local server to arbitrary origins
}

async function remuxToMp4(input: Buffer): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `clipmeme-rc-${randomBytes(16).toString("hex")}`);
  const inFile = `${tmp}.webm`;
  const outFile = `${tmp}.mp4`;
  fs.writeFileSync(inFile, input);
  try {
    await runMediaProcess(FFMPEG, [
        "-y", "-i", inFile,
        "-c", "copy",
        "-movflags", "+faststart",
        outFile,
      ]);
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(inFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const user = await requireAuth(req, res);
  if (!user) return;
  if (process.env.VERCEL) return res.status(503).json({ error: "Use direct storage uploads on this deployment" });
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method === "POST") {
    if (!await checkApiRateLimit(user.id, "upload", res)) return;
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
    const raw = Buffer.concat(chunks);
    if (!raw.length) { res.status(400).json({ error: "empty body" }); return; }

    // Remux through ffmpeg to fix MediaRecorder's missing duration metadata
    let buf = raw;
    let contentType = "video/mp4";
    try {
      buf = Buffer.from(await remuxToMp4(raw));
      console.log(`[receive-clip] remuxed ${(raw.length / 1024).toFixed(0)} KB → ${(buf.length / 1024).toFixed(0)} KB mp4`);
    } catch (e) {
      console.warn("[receive-clip] remux failed, storing raw webm:", (e as Error).message);
      buf = raw;
      contentType = "video/webm";
    }

    const id = randomBytes(16).toString("hex");
    store.set(id, { ownerId: user.id, buf, contentType });
    setTimeout(() => store.delete(id), 10 * 60 * 1000);

    res.status(200).json({ id });
    return;
  }

  if (req.method === "GET") {
    const id = req.query.id;
    if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) {
      return res.status(404).json({ error: "not found or expired" });
    }
    const entry = store.get(id);
    if (!entry || entry.ownerId !== user.id) { res.status(404).json({ error: "not found or expired" }); return; }

    res.setHeader("Content-Type", entry.contentType);
    res.setHeader("Content-Length", entry.buf.length);
    res.setHeader("Accept-Ranges", "bytes");
    res.end(entry.buf);
    return;
  }

  res.status(405).end();
}

import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import formidable from "formidable";
import { requireAuth } from "@/lib/supabase-server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { runMediaProcess } from "@/lib/media-process";

export const config = { api: { bodyParser: false, responseLimit: false } };

const FFMPEG = process.env.FFMPEG_PATH ?? (
  process.platform === "win32"
    ? "C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"
    : "ffmpeg"
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;
  if (process.env.VERCEL) return res.status(503).json({ error: "Use browser-side rendering on this deployment" });
  if (!await checkApiRateLimit(user.id, "process", res)) return;

  const form = formidable({
    multiples: true,
    maxFileSize: 500 * 1024 * 1024,
    maxTotalFileSize: 500 * 1024 * 1024,
    maxFiles: 2,
    maxFieldsSize: 64 * 1024,
    uploadDir: os.tmpdir(),
    keepExtensions: true,
  });

  let files: formidable.Files;
  try {
    [, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, f) => {
        if (err) reject(err);
        else resolve([fields, f]);
      });
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  const videoFile = Array.isArray(files.video) ? files.video[0] : files.video;
  const audioFile = Array.isArray(files.audio) ? files.audio[0] : files.audio;

  if (!videoFile) return res.status(400).json({ error: "No video file provided" });

  const id = `clipmeme-merge-${randomBytes(16).toString("hex")}`;
  const outFile = path.join(os.tmpdir(), `${id}.mp4`);

  const cleanup = () => {
    [videoFile?.filepath, audioFile?.filepath, outFile].forEach((f) => {
      if (f) fs.rmSync(f, { force: true });
    });
  };

  try {
    const args = audioFile
      ? [
          "-y",
          "-i", videoFile.filepath,
          "-i", audioFile.filepath,
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-movflags", "+faststart",
          outFile,
        ]
      : [
          "-y",
          "-i", videoFile.filepath,
          "-c", "copy",
          "-movflags", "+faststart",
          outFile,
        ];

    await runMediaProcess(FFMPEG, args);

    const stat = fs.statSync(outFile);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Content-Disposition": "attachment",
    });
    const stream = fs.createReadStream(outFile);
    stream.pipe(res);
    stream.on("close", cleanup);
  } catch (err: any) {
    cleanup();
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

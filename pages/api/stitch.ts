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
    maxFiles: 50,
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

  // Accept clips as "clip" (multiple)
  const rawClips = files["clip"];
  const clips: formidable.File[] = Array.isArray(rawClips)
    ? rawClips
    : rawClips
    ? [rawClips]
    : [];

  if (clips.length === 0) return res.status(400).json({ error: "No clips provided" });

  const id = `clipmeme-stitch-${randomBytes(16).toString("hex")}`;
  const listFile = path.join(os.tmpdir(), `${id}-list.txt`);
  const outFile = path.join(os.tmpdir(), `${id}.webm`);

  const cleanup = () => {
    [listFile, outFile].forEach((f) => fs.rmSync(f, { force: true }));
    clips.forEach((c) => fs.rmSync(c.filepath, { force: true }));
  };

  try {
    const listContent = clips.map((c) => `file '${c.filepath.replace(/'/g, "'\\''")}'`).join("\n");
    fs.writeFileSync(listFile, listContent, "utf8");

    await runMediaProcess(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outFile]);

    const stat = fs.statSync(outFile);
    res.writeHead(200, {
      "Content-Type": "video/webm",
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

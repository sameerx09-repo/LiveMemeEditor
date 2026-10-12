import type { NextApiRequest, NextApiResponse } from "next";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { requireAuth } from "@/lib/supabase-server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const config = { api: { responseLimit: false } };

const YTDLP = process.env.YTDLP_PATH ?? (process.platform === "win32"
  ? "C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python311\\Scripts\\yt-dlp.exe"
  : "yt-dlp");

import { ALLOWED_HOSTNAMES, parseHostname } from "@/lib/ytdl-utils";

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { shell: false, timeout: 60000, killSignal: "SIGKILL" });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => {
      if (out.length + d.length > 2 * 1024 * 1024) { proc.kill("SIGKILL"); reject(new Error("Video metadata exceeds size limit")); return; }
      out += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-8192)));
    proc.once("error", () => reject(new Error("Could not start video downloader")));
    proc.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim().split("\n").filter((l) => l.includes("ERROR")).pop() || `yt-dlp exited ${code}`));
    });
  });
}

// Cache: url hash → { filePath, ready, error }
const cache = new Map<string, { filePath: string; ready: boolean; error?: string; proc?: ReturnType<typeof spawn> }>();

function getCacheEntry(url: string) {
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
  const filePath = path.join(os.tmpdir(), `clipmeme-yt-${hash}.mp4`);
  return { hash, filePath };
}

function isYouTube(url: string) {
  return /youtube\.com\/watch|youtu\.be\//.test(url);
}

function buildFormat(url: string) {
  if (isYouTube(url)) {
    // YouTube: prefer h264 for broadest compat
    return "bestvideo[height<=480][vcodec~=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]/best";
  }
  // Instagram/TikTok/Twitter: `best[ext=mp4]` can select video-only DASH tracks.
  // Explicit merge ensures audio is always included.
  return "bestvideo[height<=720]+bestaudio/best[height<=720]/best";
}

function startDownload(url: string, filePath: string, hash: string) {
  if (cache.has(hash)) return;
  if (cache.size >= 10) throw new Error("Downloader is busy. Please try again later.");
  const entry = { filePath, ready: false };
  cache.set(hash, entry);

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--max-filesize", "500M",
    "--format", buildFormat(url),
    "--merge-output-format", "mp4",  // always output mp4 regardless of source container
    "-o", filePath,
  ];

  const proc = spawn(YTDLP, [...args, url], { shell: false, timeout: 300000, killSignal: "SIGKILL" });

  (entry as any).proc = proc;
  proc.once("error", () => { Object.assign(entry, { error: "Could not start video downloader" }); });
  const expiry = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    cache.delete(hash);
    for (const file of [filePath, `${filePath}.part`]) {
      try { fs.rmSync(file, { force: true }); } catch { /* An active response may still own the file on Windows. */ }
    }
  }, 60 * 60 * 1000);
  expiry.unref();

  proc.stderr.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line && !line.includes("WARNING") && !line.includes("frame=")) {
      console.log("[yt-dlp dl]", line.slice(0, 100));
    }
  });

  proc.on("close", (code) => {
    if (code === 0 && fs.existsSync(filePath)) {
      Object.assign(entry, { ready: true });
      console.log("[yt-dlp] ready:", filePath);
    } else {
      Object.assign(entry, { error: `yt-dlp exited ${code}` });
      console.error("[yt-dlp] download failed, code:", code);
    }
  });
}

function waitForFile(filePath: string, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Download timed out"));
      setTimeout(check, 500);
    };
    check();
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (process.env.VERCEL) return res.status(503).json({ error: "URL downloads require a dedicated media worker. Upload a file or use the ClipGrab extension on this deployment." });
  if (!await checkApiRateLimit(user.id, "download", res)) return;

  const { url, action } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing url" });
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return res.status(400).json({ error: "Not a valid URL" });
  }

  const hostname = parseHostname(url);
  if (!hostname || !ALLOWED_HOSTNAMES.has(hostname)) {
    return res.status(400).json({ error: "URL not from an allowed video host" });
  }

  try {
    if (action === "info") {
      const json = await runYtDlp([
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        url,
      ]);
      const data = JSON.parse(json);

      // Kick off download in background so it's ready faster
      const { hash, filePath } = getCacheEntry(url);
      startDownload(url, filePath, hash);

      return res.status(200).json({
        title: data.title,
        duration: data.duration,
        thumbnail: data.thumbnail,
        hasStream: true,
      });
    }

    // Stream the downloaded file
    const { hash, filePath } = getCacheEntry(url);

    // Start download if not already started
    startDownload(url, filePath, hash);

    // Wait for yt-dlp to finish
    try {
      await waitForFile(filePath, 120_000);
    } catch {
      const entry = cache.get(hash);
      const msg = (entry as any)?.error || "Download timed out or failed";
      return res.status(500).json({ error: msg });
    }

    const stat = fs.statSync(filePath);
    const total = stat.size;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : total - 1;
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": "video/mp4",
          "Cache-Control": "no-cache",
        });
        stream.pipe(res);
        req.on("close", () => stream.destroy());
        return;
      }
    }

    res.writeHead(200, {
      "Content-Length": total,
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    req.on("close", () => stream.destroy());
  } catch (err: any) {
    console.error("[ytdl error]", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message ?? "Failed to load video" });
    }
  }
}

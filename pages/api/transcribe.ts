import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import fs from "fs";
import { requireAuth } from "@/lib/supabase-server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const config = { api: { bodyParser: false }, maxDuration: 180 };

async function transcribeAudio(apiKey: string, filePath: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(await fs.promises.readFile(filePath))]), "audio.mp3");
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/translations", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error("Transcription provider rejected the request");
  return text;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireAuth(req, res);
  if (!user) return;
  if (!await checkApiRateLimit(user.id, "transcribe", res)) return;

  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: "GROQ_API_KEY not configured" });

  // Client sends pre-extracted audio (mp3/wav), no ffmpeg needed here
  const maxBytes = (process.env.VERCEL ? 4 : 25) * 1024 * 1024;
  const form = formidable({ maxFileSize: maxBytes, maxTotalFileSize: maxBytes, maxFiles: 1, maxFieldsSize: 64 * 1024 });

  form.parse(req, async (err, _fields, files) => {
    if (err) return res.status(400).json({ error: "File parse error" });

    const file = Array.isArray(files.audio) ? files.audio[0] : files.audio;
    if (!file) return res.status(400).json({ error: "No audio file" });

    try {
      const raw = JSON.parse(
        await transcribeAudio(
          process.env.GROQ_API_KEY!,
          file.filepath
        )
      );

      if (raw.error) throw new Error(raw.error?.message ?? "Whisper error");

      const segments: { id: number; start: number; end: number; text: string }[] =
        (raw.segments ?? [])
          .filter((s: any) => (s.no_speech_prob ?? 0) < 0.6 && (s.avg_logprob ?? 0) > -1.0)
          .map((s: any, i: number) => ({
            id: i,
            start: s.start ?? 0,
            end: s.end ?? 0,
            text: s.text.trim(),
          }));

      if (segments.length === 0 && !raw.segments?.length && raw.text) {
        segments.push({ id: 0, start: 0, end: raw.duration ?? 0, text: raw.text.trim() });
      }

      res.status(200).json({ segments, text: segments.map((s) => s.text).join(" ") });
    } catch (e: any) {
      console.error("Transcription error:", e.message ?? e);
      res.status(500).json({ error: e.message || "Transcription failed" });
    } finally {
      fs.rmSync(file.filepath, { force: true });
    }
  });
}

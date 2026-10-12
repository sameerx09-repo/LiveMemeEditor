import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return "∞";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YouTube";
  if (u.includes("hotstar.com")) return "Hotstar";
  if (u.includes("sonyliv.com")) return "SonyLIV";
  if (u.includes("zee5.com")) return "ZEE5";
  if (u.includes("twitch.tv")) return "Twitch";
  if (u.includes("jiocinemma.com") || u.includes("jiocinema")) return "JioCinema";
  return "Web";
}

export function getAspectDimensions(ar: "9:16" | "1:1" | "16:9", baseW: number) {
  const ratios: Record<string, [number, number]> = {
    "9:16": [9, 16],
    "1:1": [1, 1],
    "16:9": [16, 9],
  };
  const [w, h] = ratios[ar];
  const width = baseW;
  const height = Math.round((baseW * h) / w);
  return { width, height };
}

// Score a transcript segment for clip-worthiness
export function scoreSegment(text: string, durationSeconds: number, pauseBefore: number): number {
  let score = 0;
  const words = text.trim().split(/\s+/);
  const wordCount = words.length;

  // Word count sweet spot: 8–35 words
  if (wordCount >= 8 && wordCount <= 35) score += 0.3;
  else if (wordCount < 8) score -= 0.2;

  // Duration sweet spot: 5–20 seconds
  if (durationSeconds >= 5 && durationSeconds <= 20) score += 0.2;

  // Keyword boost
  const keywords = [
    "actually", "the thing is", "here's the truth", "nobody talks about",
    "the problem", "i realized", "the real reason", "but here's", "honestly",
    "the truth is", "what people don't", "the reason why", "i never",
    "you have to", "the most important", "this is why",
  ];
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw)) { score += 0.2; break; }
  }

  // Pause before (long pause = punchline / key point)
  if (pauseBefore >= 0.8) score += 0.15;

  // Ends with strong punctuation
  if (text.trim().match(/[!?]$/)) score += 0.1;

  // Questions are often quotable
  if (text.includes("?")) score += 0.1;

  return Math.min(1, Math.max(0, score));
}

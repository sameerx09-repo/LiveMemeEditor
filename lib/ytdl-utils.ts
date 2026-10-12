export const ALLOWED_HOSTNAMES = new Set([
  "www.youtube.com", "youtube.com", "youtu.be",
  "www.instagram.com", "instagram.com",
  "www.tiktok.com", "tiktok.com",
  "twitter.com", "x.com",
  "www.twitter.com", "www.x.com",
  "vimeo.com", "www.vimeo.com",
]);

export function parseHostname(raw: string): string | null {
  try { return new URL(raw).hostname; } catch { return null; }
}

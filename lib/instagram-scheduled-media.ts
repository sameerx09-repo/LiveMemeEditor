import { signInstagramMediaUrl, verifyInstagramMediaSignature } from "./instagram";

function readReference(mediaUrl: string, userId: string) {
  const url = new URL(mediaUrl);
  const key = url.searchParams.get("key");
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/api/instagram/media" || !key?.startsWith(`social/instagram/${userId}/`)) {
    throw new Error("Scheduled video must be an uploaded clip belonging to this account");
  }
  return { url, key };
}

export function createScheduledMediaReference(mediaUrl: string, userId: string, baseUrl: string) {
  const { url, key } = readReference(mediaUrl, userId);
  if (url.origin !== new URL(baseUrl).origin || !verifyInstagramMediaSignature(key, url.searchParams.get("expires") || "", url.searchParams.get("sig") || "")) {
    throw new Error("Upload the clip again before scheduling");
  }
  // Persist the storage reference, rather than a token that expires before the post is due.
  return `${url.origin}${url.pathname}?${new URLSearchParams({ key })}`;
}

export function refreshScheduledMediaUrl(mediaUrl: string, userId: string, baseUrl?: string) {
  const { url, key } = readReference(mediaUrl, userId);
  const configuredUrl = process.env.INSTAGRAM_REDIRECT_URI;
  const origin = baseUrl ? new URL(baseUrl).origin : configuredUrl ? new URL(configuredUrl).origin : url.origin;
  return signInstagramMediaUrl(origin, key);
}

import crypto from "crypto";
import { serializeCookieHeader } from "@supabase/ssr";
import type { NextApiResponse } from "next";

export const INSTAGRAM_OAUTH_COOKIE = "clipmeme_ig_oauth";
export const INSTAGRAM_OAUTH_TTL = 600;

function stateSecret() {
  const secret = process.env.INSTAGRAM_STATE_SECRET || process.env.INSTAGRAM_APP_SECRET;
  if (!secret) throw new Error("Missing Instagram OAuth signing configuration");
  return secret;
}
function bindingHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function constantEqual(actual: string, expected: string) {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createInstagramOAuthState(userId: string, browserToken: string) {
  if (!/^[a-f0-9]{64}$/.test(browserToken)) throw new Error("Invalid OAuth browser binding");
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    nonce: crypto.randomBytes(16).toString("hex"), userId,
    binding: bindingHash(browserToken), issuedAt, expiresAt: issuedAt + INSTAGRAM_OAUTH_TTL,
  })).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url")}`;
}

export function readInstagramOAuthState(state: string | string[] | undefined, browserToken: string | undefined): { userId: string } {
  if (typeof state !== "string" || state.length > 2048 || !browserToken || !/^[a-f0-9]{64}$/.test(browserToken)) {
    throw new Error("Instagram authorization expired. Connect again from this browser.");
  }
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid OAuth state");
  const [payload, signature] = parts;
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  if (!constantEqual(signature, expected)) throw new Error("Invalid OAuth state");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (!decoded || typeof decoded.userId !== "string" || !decoded.userId ||
      typeof decoded.nonce !== "string" || !/^[a-f0-9]{32}$/.test(decoded.nonce) ||
      !Number.isInteger(decoded.issuedAt) || !Number.isInteger(decoded.expiresAt) ||
      decoded.issuedAt > now || decoded.expiresAt <= now ||
      decoded.expiresAt - decoded.issuedAt !== INSTAGRAM_OAUTH_TTL ||
      typeof decoded.binding !== "string" || !constantEqual(decoded.binding, bindingHash(browserToken))) {
    throw new Error("Instagram authorization expired or belongs to another browser. Connect again.");
  }
  return { userId: decoded.userId };
}

export function setInstagramOAuthCookie(res: NextApiResponse, token: string, redirectUri: string) {
  const existing = res.getHeader("Set-Cookie");
  const cookie = serializeCookieHeader(INSTAGRAM_OAUTH_COOKIE, token, {
    path: "/api/instagram", httpOnly: true, sameSite: "lax",
    secure: new URL(redirectUri).protocol === "https:", maxAge: token ? INSTAGRAM_OAUTH_TTL : 0,
  });
  res.setHeader("Set-Cookie", [...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []), cookie]);
}

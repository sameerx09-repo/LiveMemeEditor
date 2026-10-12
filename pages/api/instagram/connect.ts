import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { requireAuth } from "@/lib/supabase-server";
import { buildInstagramAuthUrl, getInstagramRedirectUri } from "@/lib/instagram";
import { setInstagramOAuthCookie } from "@/lib/instagram-oauth";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Could not start Instagram connect";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");

  const user = await requireAuth(req, res);
  if (!user) return;
  if (!await checkApiRateLimit(user.id, "connect", res)) return;

  try {
    const redirectUri = getInstagramRedirectUri(req);
    if (req.headers.host !== new URL(redirectUri).host) {
      return res.status(409).json({ error: `Open ${new URL(redirectUri).origin} and sign in there before connecting Instagram.` });
    }
    const browserToken = randomBytes(32).toString("hex");
    const authUrl = buildInstagramAuthUrl(user.id, redirectUri, browserToken);
    setInstagramOAuthCookie(res, browserToken, redirectUri);
    res.status(200).json({ authUrl });
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import {
  discoverInstagramAccount,
  exchangeCodeForToken,
  getInstagramRedirectUri,
  readInstagramOAuthState,
  saveInstagramAccount,
} from "@/lib/instagram";
import { getCookieUser } from "@/lib/supabase-server";
import { INSTAGRAM_OAUTH_COOKIE, setInstagramOAuthCookie } from "@/lib/instagram-oauth";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Instagram connection failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  let stage="validation";
  try {
    const redirectUri = getInstagramRedirectUri(req);
    // State must belong to this browser and the still-authenticated initiating account.
    const { userId } = readInstagramOAuthState(req.query.state, req.cookies[INSTAGRAM_OAUTH_COOKIE]);
    setInstagramOAuthCookie(res, "", redirectUri);
    const user = await getCookieUser(req, res);
    if (!user || user.id !== userId) throw new Error("Sign in to the account that started Instagram connect and try again.");
    const code = req.query.code;
    if (!code || Array.isArray(code)) throw new Error("Missing OAuth code");

    stage="token_exchange";
    const accessToken = await exchangeCodeForToken(code, redirectUri);
    stage="account_lookup";
    const account = await discoverInstagramAccount(accessToken);

    stage="save_connection";
    await saveInstagramAccount(userId, { ...account, accessToken });
    res.redirect("/?instagram=connected");
  } catch (err: unknown) {
    // Never log OAuth codes, state, tokens, request URLs, or raw error objects.
    console.error("[Instagram connect] callback failed", { stage });
    res.redirect(`/?instagram_error=${encodeURIComponent(errorMessage(err))}&instagram_stage=${stage}`);
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { disconnectInstagramAccount, getDefaultInstagramAccount, getRequestBaseUrl } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { setInstagramOAuthCookie } from "@/lib/instagram-oauth";
import { validPostId } from "@/lib/manual-posts";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).end();
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    if (req.method === "DELETE") {
      if (!await checkApiRateLimit(user.id, "connect", res)) return;
      const origin = getRequestBaseUrl(req);
      const accountId=req.body?.accountId;
      if(!validPostId(accountId)) return res.status(400).json({error:"Select the Instagram account to disconnect"});
      await disconnectInstagramAccount(user.id,accountId);
      setInstagramOAuthCookie(res, "", origin);
      return res.status(200).json({ ok:true,disconnectedAccountId:accountId });
    }
    const account = await getDefaultInstagramAccount(user.id);
    res.status(200).json({
      connected: !!account,
      username: account?.username ?? null,
      igUserId: account?.igUserId ?? null,
    });
  } catch {
    res.status(503).json({ error: req.method === "DELETE"
      ? "Could not disconnect Instagram. Refresh the connection and try again."
      : "Could not load Instagram account. Please try again." });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { getDefaultInstagramAccount } from "@/lib/instagram";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Could not load Instagram account";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const account = await getDefaultInstagramAccount(user.id);
    res.status(200).json({
      connected: !!account,
      username: account?.username ?? null,
      igUserId: account?.igUserId ?? null,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

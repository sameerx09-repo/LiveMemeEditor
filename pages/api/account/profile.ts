import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { getAccountProfile, MEMBERSHIP_UNAVAILABLE } from "@/lib/membership-server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const authenticated = await requireAuth(req, res);
  if (!authenticated) return;
  try {
    return res.status(200).json(await getAccountProfile(authenticated.id));
  } catch {
    return res.status(503).json({ error: MEMBERSHIP_UNAVAILABLE });
  }
}

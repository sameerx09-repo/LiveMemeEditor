import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/instagram";
import { resolveMembership } from "@/lib/membership";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const authenticated = await requireAuth(req, res);
  if (!authenticated) return;
  try {
    // Read the current record, not potentially stale metadata in a session JWT.
    const { data, error } = await createAdminClient().auth.admin.getUserById(authenticated.id);
    const user = data?.user;
    if (error || !user || user.id !== authenticated.id) throw new Error("Profile unavailable");
    return res.status(200).json({
      id: user.id,
      email: user.email ?? "",
      ...resolveMembership(user.app_metadata),
    });
  } catch {
    return res.status(503).json({ error: "Could not load your membership. Please try again." });
  }
}

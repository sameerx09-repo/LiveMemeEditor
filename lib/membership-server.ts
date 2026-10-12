import type { NextApiResponse } from "next";
import { createAdminClient } from "@/lib/instagram";
import { resolveMembership, type AccountProfile } from "@/lib/membership";

export const INSTAGRAM_PRO_REQUIRED = "Instagram posting and scheduling require Pro.";
export const MEMBERSHIP_UNAVAILABLE = "Could not load your membership. Please try again.";

export async function getAccountProfile(userId: string): Promise<AccountProfile> {
  try {
    // Do not authorize with potentially stale JWT metadata or user-editable metadata.
    const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
    const user = data?.user;
    if (error || !user || user.id !== userId) throw new Error(MEMBERSHIP_UNAVAILABLE);
    return { id: user.id, email: user.email ?? "", ...resolveMembership(user.app_metadata) };
  } catch {
    throw new Error(MEMBERSHIP_UNAVAILABLE);
  }
}

export async function requireInstagramPro(userId: string, res: NextApiResponse): Promise<boolean> {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if ((await getAccountProfile(userId)).plan === "pro") return true;
    res.status(403).json({ code: "PRO_REQUIRED", error: INSTAGRAM_PRO_REQUIRED });
  } catch {
    res.status(503).json({ code: "MEMBERSHIP_UNAVAILABLE", error: MEMBERSHIP_UNAVAILABLE });
  }
  return false;
}

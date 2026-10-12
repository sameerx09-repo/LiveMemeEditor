import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { getInstagramSchedulerStatus } from "@/lib/instagram-scheduler-status";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(getInstagramSchedulerStatus());
}

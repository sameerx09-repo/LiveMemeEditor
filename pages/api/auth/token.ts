import type { NextApiRequest, NextApiResponse } from "next";
import { createApiClient, getCookieUser } from "@/lib/supabase-server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();
  res.setHeader("Cache-Control", "no-store");
  const user = await getCookieUser(req, res);
  if (!user) return res.status(401).json({ error: "Not logged in" });

  const supabase = createApiClient(req, res);
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token || session.user.id !== user.id) {
    return res.status(401).json({ error: "Not logged in" });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ access_token: session.access_token });
}

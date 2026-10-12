import type { NextApiRequest, NextApiResponse } from "next";
import { isSignupEnabled } from "@/lib/auth-config";
import { createApiClient } from "@/lib/supabase-server";

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!isSignupEnabled()) return res.status(403).json({ error: "New account signup is currently disabled." });

  let sameOrigin = false;
  try {
    const origin = new URL(req.headers.origin ?? "");
    sameOrigin = ["https:", "http:"].includes(origin.protocol) &&
      origin.origin === req.headers.origin && origin.host === req.headers.host;
  } catch { /* Missing or malformed origins are not browser signup submissions. */ }
  if (!sameOrigin) return res.status(403).json({ error: "Signup must be submitted from this website." });
  if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return res.status(415).json({ error: "Expected a JSON request." });
  }
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== "string" || password.length < 6 || password.length > 1024) {
    return res.status(400).json({ error: "Enter a valid email and a password of at least 6 characters." });
  }
  try {
    // Uses the anonymous Auth client, never the admin/service role signup bypass.
    const { error } = await createApiClient(req, res).auth.signUp({ email: email.trim(), password });
    if (error) {
      const status = error.status === 429 ? 429 : (error.status ?? 0) >= 500 ? 503 : 400;
      return res.status(status).json({ error: "Could not create your account. Please try again later." });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ error: "Signup is temporarily unavailable. Please try again later." });
  }
}

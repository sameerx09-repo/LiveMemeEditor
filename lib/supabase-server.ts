import { createServerClient, serializeCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";
import type { CookieOptions } from "@supabase/ssr";

/** Create a Supabase client for use inside API route handlers. */
export function createApiClient(req: NextApiRequest, res: NextApiResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(req.cookies).map(([name, value]) => ({ name, value: value ?? "" }));
        },
        setAll(cookies: { name: string; value: string; options: CookieOptions }[]) {
          // Preserve refresh/deletion attributes and cookies set by the OAuth flow.
          const existing = res.getHeader("Set-Cookie");
          const cookieStrings = cookies.map(({ name, value, options }) =>
            serializeCookieHeader(name, value, options)
          );
          if (cookieStrings.length > 0) res.setHeader("Set-Cookie", [
            ...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []),
            ...cookieStrings,
          ]);
        },
      },
    }
  );
}

type AuthenticatedUser = { id: string; email: string };

function validatedUser(claims: Record<string, unknown> | undefined): AuthenticatedUser | null {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const now = Math.floor(Date.now() / 1000);
  if (!projectUrl || !claims || claims.iss !== `${projectUrl}/auth/v1` ||
      claims.role !== "authenticated" ||
      !(claims.aud === "authenticated" || (Array.isArray(claims.aud) && claims.aud.includes("authenticated"))) ||
      typeof claims.sub !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(claims.sub) ||
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now ||
      (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now))) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
}

/** Verify against the configured project's rotating keys, not a hardcoded JWK. */
export async function requireAuth(req: NextApiRequest, res: NextApiResponse): Promise<AuthenticatedUser | null> {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^Bearer \S+$/i.test(auth)) {
    try {
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await client.auth.getClaims(auth.slice(7));
      const user = !error ? validatedUser(data?.claims) : null;
      if (user) return user;
    } catch { /* Invalid tokens or unavailable verification fail closed without logging credentials. */ }
  }
  res.status(401).json({ error: "Unauthorized" });
  return null;
}

/** OAuth navigation has no Authorization header; verify the browser's cookie session. */
export async function getCookieUser(req: NextApiRequest, res: NextApiResponse): Promise<AuthenticatedUser | null> {
  try {
    const { data, error } = await createApiClient(req, res).auth.getClaims();
    return !error ? validatedUser(data?.claims) : null;
  } catch { return null; }
}

/** Get user's plan from profiles table. Defaults to 'free'. */
export async function getUserPlan(userId: string): Promise<"free" | "paid"> {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await admin.from("profiles").select("plan").eq("id", userId).single();
  return (data?.plan as "free" | "paid") ?? "free";
}

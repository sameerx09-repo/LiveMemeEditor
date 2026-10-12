export type Membership = {
  plan: "free" | "pro";
  expiresAt: string | null;
};

export type AccountProfile = Membership & { id: string; email: string };

// Only Auth's admin-controlled app_metadata is an entitlement source.
export function resolveMembership(appMetadata: Record<string, unknown> | undefined, now = Date.now()): Membership {
  const free: Membership = { plan: "free", expiresAt: null };
  if (appMetadata?.plan !== "pro") return free;
  const expiry = appMetadata.plan_expires_at;
  if (expiry === undefined || expiry === null) return { plan: "pro", expiresAt: null };
  if (typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(expiry)) return free;
  const timestamp = Date.parse(expiry);
  if (!Number.isFinite(timestamp) || timestamp <= now) return free;
  return { plan: "pro", expiresAt: new Date(timestamp).toISOString() };
}

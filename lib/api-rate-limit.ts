import type { NextApiResponse } from "next";
import { createAdminClient } from "@/lib/instagram";

// Abuse ceilings, independent of future Free/Pro product entitlements.
const hourlyLimits = { upload: 60, process: 60, transcribe: 10, publish: 60, schedule: 120, connect: 30, download: 30 };
type Operation = keyof typeof hourlyLimits;
type RateWindow = { count: number; window: number };
const state = globalThis as typeof globalThis & { clipmemeRateWindows?: Map<string, RateWindow> };

export async function checkApiRateLimit(userId: string, operation: Operation, res: NextApiResponse): Promise<boolean> {
  const limit = hourlyLimits[operation];
  let allowed: boolean;
  try {
    if (process.env.NODE_ENV === "production") {
      // Atomic database counters cannot be bypassed by changing web replicas.
      const { data, error } = await createAdminClient().rpc("check_api_rate_limit", {
        p_user_id: userId, p_operation: operation, p_limit: limit, p_window_seconds: 3600,
      });
      if (error || typeof data !== "boolean") throw new Error("Rate limit unavailable");
      allowed = data;
    } else {
      const windows = state.clipmemeRateWindows ??= new Map();
      const window = Math.floor(Date.now() / 3600000);
      for (const [key, value] of windows) { if (value.window !== window) windows.delete(key); }
      if (windows.size >= 10000) throw new Error("Rate limit capacity exceeded");
      const key = `${userId}:${operation}`;
      const value = windows.get(key) ?? { count: 0, window };
      allowed = value.count < limit;
      if (allowed) { value.count++; windows.set(key, value); }
    }
  } catch {
    res.status(503).json({ error: "Request protection is unavailable. Please try again later." });
    return false;
  }
  if (!allowed) {
    res.setHeader("Retry-After", String(3600 - Math.floor(Date.now() / 1000) % 3600));
    res.status(429).json({ error: "Request limit reached. Please try again later." });
  }
  return allowed;
}

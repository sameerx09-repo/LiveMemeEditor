import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { AccountProfile } from "@/lib/membership";

const proRequired = "Instagram posting and scheduling require Pro.";

export function useInstagramAccess() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (controller.signal.aborted) return false;
      setLoading(true);
      setError(false);
      if (!session) throw new Error("Missing session");
      const response = await fetch("/api/account/profile", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Membership unavailable");
      const next: AccountProfile = await response.json();
      if (next.id !== session.user.id || !["free", "pro"].includes(next.plan)) throw new Error("Invalid profile");
      if (controller.signal.aborted) return false;
      const activePro = next.plan === "pro" && (!next.expiresAt || Date.parse(next.expiresAt) > Date.now());
      setProfile({ ...next, plan: activePro ? "pro" : "free" });
      return activePro;
    } catch {
      if (!controller.signal.aborted) { setProfile(null); setError(true); }
      return false;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => {
      request.current?.abort();
      window.clearTimeout(initial); window.clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    if (profile?.plan !== "pro" || !profile.expiresAt) return;
    const remaining = Math.max(1, Date.parse(profile.expiresAt) - Date.now());
    const timer = window.setTimeout(() => void refresh(), Math.min(remaining, 2147483647));
    return () => window.clearTimeout(timer);
  }, [profile, refresh]);
  const allowed = !loading && !error && profile?.plan === "pro";
  return {
    allowed, refresh,
    message: loading ? "Checking membership..." : error ? "Membership unavailable. Retry." : allowed ? "" : proRequired,
  };
}

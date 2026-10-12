import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleAlert, LoaderCircle, LogOut, RefreshCw, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import type { AccountProfile } from "@/lib/membership";
import InstagramConnection from "@/components/Social/InstagramConnection";

type Props = { userId: string; email: string; onSignOut: () => Promise<void> };

export default function UserProfile({ userId, email, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return createClient().auth.getSession().then(async ({ data: { session } }) => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(false);
      if (!session || session.user.id !== userId) throw new Error("Missing session");
      const response = await fetch("/api/account/profile", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Profile unavailable");
      const next: AccountProfile = await response.json();
      if (next.id !== userId || !["free", "pro"].includes(next.plan)) throw new Error("Invalid profile");
      if (!controller.signal.aborted) setProfile(next);
    }).catch(() => {
      if (!controller.signal.aborted) { setProfile(null); setError(true); }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }, [userId]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { request.current?.abort(); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);

  const label = profile?.plan === "pro" ? "Pro" : profile?.plan === "free" ? "Free" : null;
  const accountEmail = profile?.email || email;
  const badge = profile?.plan === "pro" ? "bg-[#253c32] text-[#90dfae]" : "bg-[#303030] text-[#ddd]";

  return <div ref={container} className="relative ml-auto shrink-0 text-xs" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={toggle} type="button" aria-label={`User profile${label ? `, ${label} plan` : ""}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "user-profile-panel" : undefined}
      onClick={() => { setOpen(!open); if (!open) void refresh(); }}
      className="flex h-9 items-center gap-2 rounded border border-[#333] px-2.5 text-[#ddd] hover:border-[#666] focus-visible:outline-2 focus-visible:outline-[#ff4444]">
      <UserRound size={16} aria-hidden="true" />
      <span className="hidden max-w-44 truncate sm:block">{accountEmail || "Account"}</span>
      <span className={`inline-flex h-5 w-10 items-center justify-center rounded ${badge}`}>
        {label ?? (error ? <CircleAlert size={13} aria-label="Membership unavailable" /> : <LoaderCircle size={13} className="animate-spin" aria-label="Loading membership" />)}
      </span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div id="user-profile-panel" role="dialog" aria-label="User profile"
      className="absolute right-0 top-full z-[80] mt-2 max-h-[calc(100dvh-6rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-[#383838] bg-[#181818] p-4 text-[#ddd] shadow-xl">
      <div className="font-semibold text-white">Account</div>
      <p className="mt-1 break-all text-[#aaa]">{accountEmail || "Signed in"}</p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#333] pt-3">
        <span>Membership</span>
        <div className="flex items-center gap-2">
          <span role="status" className="text-xs">{label ? <span className={`rounded px-2 py-1 font-medium ${badge}`}>{label}</span> : error ? "Unavailable" : "Loading..."}</span>
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh membership" title="Refresh membership"
            className="flex h-7 w-7 items-center justify-center rounded text-[#aaa] hover:bg-[#303030] disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden="true" />
          </button>
        </div>
      </div>
      {profile?.expiresAt && <p className="mt-2 text-[#aaa]">Valid until {new Date(profile.expiresAt).toLocaleDateString()}</p>}
      {error && <p role="alert" className="mt-2 text-[#ff9b9b]">Could not load membership. Please retry.</p>}
      <InstagramConnection userId={userId} />
      <button type="button" disabled={signingOut} onClick={async () => {
        setSigningOut(true);
        try { await onSignOut(); } finally { setSigningOut(false); }
      }} className="mt-4 flex min-h-8 w-full items-center gap-2 border-t border-[#333] pt-3 text-[#bbb] hover:text-white disabled:opacity-50">
        <LogOut size={14} aria-hidden="true" />{signingOut ? "Signing out..." : "Sign out"}
      </button>
    </div>}
  </div>;
}

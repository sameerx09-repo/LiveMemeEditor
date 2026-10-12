import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Camera, Link2, LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { INSTAGRAM_CONNECTION_CHANGED, notifyInstagramConnectionChanged } from "@/lib/instagram-connection-events";

type Connection = { connected: boolean; username: string | null; igUserId: string | null };
const button = "flex min-h-8 items-center justify-center gap-2 rounded border border-[#444] px-2 py-1.5 text-xs text-[#ddd] hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-40";

export default function InstagramConnection({ userId }: { userId: string }) {
  const [account, setAccount] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"disconnect" | "change" | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const working = useRef(false);

  const authHeaders = useCallback(async () => {
    const { data: { session } } = await createClient().auth.getSession();
    if (!session || session.user.id !== userId) throw new Error("Sign in to this account again.");
    return { Authorization: `Bearer ${session.access_token}` };
  }, [userId]);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const headers = await authHeaders();
      if (controller.signal.aborted) return;
      setLoading(true); setLoadError(false);
      const res = await fetch("/api/instagram/account", { headers, cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("Connection unavailable");
      const data: Connection = await res.json();
      if (typeof data.connected !== "boolean" || (data.connected && (typeof data.username !== "string" || typeof data.igUserId !== "string"))) throw new Error("Invalid connection");
      if (!controller.signal.aborted) setAccount(data);
    } catch {
      if (!controller.signal.aborted) { setAccount(null); setLoadError(true); }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = () => { if (!working.current) void load(); };
    window.addEventListener("focus", refresh);
    window.addEventListener(INSTAGRAM_CONNECTION_CHANGED, refresh);
    return () => {
      mounted.current = false; request.current?.abort();
      window.clearTimeout(initial);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(INSTAGRAM_CONNECTION_CHANGED, refresh);
    };
  }, [load]);

  async function authorize() {
    const res = await fetch("/api/instagram/connect", { headers: await authHeaders(), cache: "no-store" });
    const data = await res.json();
    if (!res.ok || typeof data.authUrl !== "string") throw new Error(data.error || "Could not connect Instagram.");
    if (mounted.current) window.location.assign(data.authUrl);
  }

  async function act(action: "connect" | "disconnect" | "change") {
    if (working.current) return;
    working.current = true; setBusy(true); setMessage(""); setFailed(false);
    try {
      if (action !== "connect") {
        const res = await fetch("/api/instagram/account", { method: "DELETE", headers: await authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not disconnect Instagram.");
        request.current?.abort();
        if (mounted.current) {
          setAccount({ connected: false, username: null, igUserId: null });
          setLoading(false); setLoadError(false); setConfirmation(null);
          setMessage("Instagram disconnected.");
        }
        notifyInstagramConnectionChanged();
      }
      if (action !== "disconnect" && mounted.current) await authorize();
    } catch (error) {
      if (mounted.current) {
        setFailed(true); setMessage(error instanceof Error ? error.message : "Instagram connection failed.");
        setConfirmation(null); void load();
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section aria-label="Instagram connection" className="mt-4 border-t border-[#333] pt-3">
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-xs font-semibold text-white"><Camera size={15} aria-hidden="true" />Instagram</h2>
      <button type="button" title="Refresh Instagram connection" aria-label="Refresh Instagram connection" disabled={busy || loading} onClick={() => void load()} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#aaa] hover:bg-[#303030] disabled:opacity-40"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
    </div>
    {loading ? <p role="status" className="mt-2 flex items-center gap-2 text-[#aaa]"><LoaderCircle size={13} className="animate-spin" />Loading connection...</p>
      : loadError ? <p role="alert" className="mt-2 text-[#ff9b9b]">Could not load Instagram. Refresh to retry.</p>
      : <p className={`mt-2 break-all ${account?.connected ? "text-[#90dfae]" : "text-[#aaa]"}`}>{account?.connected ? `@${account.username}` : "Not connected"}</p>}
    {!confirmation && !loading && !loadError && (account?.connected ? <div className="mt-3 grid gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => { setMessage(""); setConfirmation("change"); }}><ArrowLeftRight size={14} />Change account</button>
      <button type="button" className={button} disabled={busy} onClick={() => { setMessage(""); setConfirmation("disconnect"); }}><Unplug size={14} />Disconnect Instagram</button>
    </div> : <button type="button" className={`${button} mt-3 w-full`} disabled={busy || !account} onClick={() => void act("connect")}><Link2 size={14} />{busy ? "Connecting..." : "Connect Instagram"}</button>)}
    {confirmation && <div className="mt-3 space-y-3">
      <p role="alert" className="break-words text-[#ddd]">Disconnect @{account?.username}? Queued Instagram posts will be stopped. Posts already publishing may still finish. Published posts and history will remain.</p>
      <div className="flex flex-wrap gap-2">
        <button autoFocus type="button" className={button} disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
        <button type="button" className={`${button} border-[#a94c52] text-[#ffb2b2]`} disabled={busy || loading || loadError || !account?.connected} onClick={() => void act(confirmation)}><Unplug size={13} />{busy ? "Disconnecting..." : confirmation === "change" ? "Disconnect and connect" : "Confirm disconnect"}</button>
      </div>
    </div>}
    {message && <p role={failed ? "alert" : "status"} className={`mt-2 break-words ${failed ? "text-[#ff9b9b]" : "text-[#aaa]"}`}>{message}</p>}
  </section>;
}

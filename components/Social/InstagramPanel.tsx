import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Camera, UploadCloud } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { useStore } from "@/lib/store";
import type { ClipHistoryItem } from "@/lib/types";
import { linkScheduledClip } from "@/lib/export-history";
import { uploadInstagramClip } from "@/lib/instagram-upload-client";

type AccountState = {
  connected: boolean;
  username: string | null;
};

type StatusKind = "idle" | "working" | "success" | "error";

type InstagramPanelProps = {
  renderCurrent: () => Promise<ClipHistoryItem | undefined>;
  canRender: boolean;
  renderPrimaryAction?: (action: {
    connected: boolean;
    canPost: boolean;
    working: boolean;
    onConnect: () => void;
    onPublish: () => void;
  }) => React.ReactNode;
};

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong";
}

export default function InstagramPanel({ renderPrimaryAction, renderCurrent, canRender }: InstagramPanelProps) {
  const history = useStore((s) => s.history);
  const latestExport = history.find((item) => item.exportUrl);
  const [account, setAccount] = useState<AccountState>({ connected: false, username: null });
  const [scheduler, setScheduler] = useState<{enabled: boolean; message: string} | null>(null);
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [postDialog, setPostDialog] = useState(false);
  const [status, setStatus] = useState<{ kind: StatusKind; text: string }>({ kind: "idle", text: "" });

  const canUseExport = !!latestExport?.exportUrl;
  const scheduleLabel = useMemo(() => {
    if (!scheduledAt) return "Pick a time";
    const d = new Date(scheduledAt);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : "Pick a time";
  }, [scheduledAt]);

  async function authHeaders(): Promise<Record<string, string>> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }

  async function loadAccount() {
    try {
      const res = await fetch("/api/instagram/account", { headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load Instagram account");
      setAccount({ connected: data.connected, username: data.username });
    } catch (err: unknown) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  }

  async function loadScheduler() {
    const res = await fetch("/api/instagram/scheduler-status", { headers: await authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not check scheduler");
    setScheduler(data);
    return data;
  }

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadAccount();
      void loadScheduler().catch(() => setScheduler({enabled: false, message: "Scheduler status unavailable"}));
    }, 0);
    const refresh = window.setInterval(() => {
      void loadScheduler().catch(() => setScheduler({enabled: false, message: "Scheduler status unavailable"}));
    }, 30000);
    return () => { window.clearTimeout(id); window.clearInterval(refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectInstagram() {
    try {
      setStatus({ kind: "working", text: "Opening Instagram connect..." });
      const res = await fetch("/api/instagram/connect", { headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start Instagram connect");
      window.location.assign(data.authUrl);
    } catch (err: unknown) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  }

  async function ensureUploaded(item = latestExport) {
    if (!item?.exportUrl) throw new Error("Save a clip to History first");

    setStatus({ kind: "working", text: "Uploading exported clip..." });
    const response = await fetch(item.exportUrl);
    if (!response.ok) throw new Error("Saved clip is unavailable");
    const blob = await response.blob();
    const contentType = blob.type || (item.exportFileName?.endsWith(".webm") ? "video/webm" : "video/mp4");
    return uploadInstagramClip(blob.type ? blob : new Blob([blob], { type: contentType }), await authHeaders());
  }

  async function publishNow() {
    if (status.kind === "working") return;
    try {
      if (!account.connected) throw new Error("Connect Instagram first");
      setStatus({ kind: "working", text: "Rendering and saving current edit..." });
      const item = await renderCurrent();
      if (!item) throw new Error("Could not save current edit; nothing was posted");
      const mediaUrl = await ensureUploaded(item);
      setStatus({ kind: "working", text: "Publishing to Instagram..." });
      const res = await fetch("/api/instagram/publish", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mediaUrl, caption }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publish failed");
      setStatus({ kind: "success", text: "Published to Instagram." });
      setPostDialog(false);
    } catch (err: unknown) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  }

  async function schedulePost() {
    if (status.kind === "working") return;
    try {
      if (!account.connected) throw new Error("Connect Instagram first");
      if (!scheduledAt) throw new Error("Choose a schedule time");
      if (new Date(scheduledAt).getTime() <= Date.now()) throw new Error("Choose a future schedule time");
      setStatus({ kind: "working", text: "Checking scheduler..." });
      const worker = await loadScheduler();
      if (!worker.enabled) throw new Error(worker.message);
      const mediaUrl = await ensureUploaded();
      setStatus({ kind: "working", text: "Scheduling Instagram post..." });
      const res = await fetch("/api/instagram/schedule", {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mediaUrl, caption, scheduledAt: new Date(scheduledAt).toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Schedule failed");
      let referenceSaved = true;
      try {
        const { data: { session } } = await createClient().auth.getSession();
        if (!session || !latestExport) throw new Error("Saved clip unavailable");
        await linkScheduledClip(session.user.id, data.post.id, latestExport);
      } catch { referenceSaved = false; }
      setStatus({ kind: "success", text: `Scheduled for ${scheduleLabel}.${referenceSaved ? "" : " History reference could not be saved."}` });
    } catch (err: unknown) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  }

  return (
    <div className="mt-auto border-t border-[#1e1e1e] pt-3">
      {renderPrimaryAction?.({
        connected: account.connected,
        canPost: canRender,
        working: status.kind === "working",
        onConnect: connectInstagram,
        onPublish: () => { setStatus({ kind: "idle", text: "" }); setPostDialog(true); },
      })}

      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider">Instagram</p>
        {account.connected ? (
          <span className="text-[10px] text-[#4caf50] truncate max-w-[150px]">@{account.username}</span>
        ) : null}
      </div>

      {!account.connected ? (
        <button
          onClick={connectInstagram}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#111] border border-[#2e2e2e] hover:border-[#ff4444] rounded-lg text-xs text-[#ddd] transition-colors"
        >
          <Camera size={14} />
          Connect Instagram
        </button>
      ) : (
        <div className="space-y-2">
          <p role="status" className={`text-[10px] ${scheduler?.enabled ? "text-[#78cfc8]" : "text-[#ffca28]"}`}>{scheduler?.message || "Checking scheduler..."}</p>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption"
            aria-label="Scheduled post caption"
            maxLength={2200}
            rows={3}
            className="w-full resize-none bg-[#111] border border-[#1e1e1e] rounded-lg px-3 py-2 text-xs text-white placeholder-[#444] focus:outline-none focus:border-[#ff4444]"
          />

          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="min-w-0 flex-1 bg-[#111] border border-[#1e1e1e] rounded-lg px-2 py-2 text-[11px] text-[#bbb] focus:outline-none focus:border-[#ff4444]"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={schedulePost}
              disabled={!canUseExport || !scheduler?.enabled || status.kind === "working"}
              className="col-span-2 flex items-center justify-center gap-1.5 py-2 bg-[#111] border border-[#2e2e2e] hover:border-[#ffca28] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-[#ffca28] font-bold text-xs transition-colors"
            >
              <CalendarClock size={13} />
              Schedule
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-[#555]">
            <UploadCloud size={12} />
            <span className="truncate">
              {canUseExport ? latestExport?.exportFileName || "Saved clip ready" : "No saved clips"}
            </span>
          </div>
        </div>
      )}

      {status.text && (
        <p className={`mt-2 text-[10px] ${
          status.kind === "error" ? "text-[#ff4444]" :
          status.kind === "success" ? "text-[#4caf50]" :
          "text-[#888]"
        }`}>
          {status.text}
        </p>
      )}
      {postDialog && (
        <div role="dialog" aria-modal="true" aria-labelledby="instagram-post-title" className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-lg border border-[#333] bg-[#191919] p-5 space-y-4">
            <h2 id="instagram-post-title" className="text-sm font-semibold text-white">Post to Instagram</h2>
            <p className="text-xs text-[#aaa]">@{account.username}</p>
            <label className="block text-xs text-[#ccc]">Caption
              <textarea autoFocus value={caption} maxLength={2200} disabled={status.kind === "working"} onChange={e => setCaption(e.target.value)} rows={4} className="block w-full mt-2 p-2 bg-[#111] border border-[#333] rounded text-white" />
            </label>
            {status.text && <p role="status" className="text-xs text-[#ddd]">{status.text}</p>}
            <div className="flex justify-end gap-2">
              <button disabled={status.kind === "working"} onClick={() => setPostDialog(false)} className="px-3 py-2 text-xs text-[#aaa]">Cancel</button>
              <button disabled={status.kind === "working" || !canRender} onClick={() => void publishNow()} className="px-3 py-2 text-xs bg-[#c93640] rounded text-white disabled:opacity-40">{status.kind === "working" ? "Posting..." : "Post now"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

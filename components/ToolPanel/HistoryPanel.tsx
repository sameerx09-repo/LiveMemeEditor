import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { StoredSourceClip } from "@/lib/clip-db";
import { formatTime } from "@/lib/utils";
import { createClient } from "@/lib/supabase-browser";
import { Download } from "lucide-react";
import type { ClipHistoryItem } from "@/lib/types";

export default function HistoryPanel({ userId }: { userId: string | null }) {
  const history = useStore((s) => s.history);
  const clearHistory = useStore((s) => s.clearHistory);
  const exporting = useStore((s) => s.exporting);
  const setSource = useStore((s) => s.setSource);
  const clearSource = useStore((s) => s.clearSource);

  const [sourceClips, setSourceClips] = useState<StoredSourceClip[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleClearHistory = async () => {
    if (!window.confirm("Delete all saved clips from this browser? Scheduled posts will remain queued.")) return;
    setBusy(true); setHistoryError("");
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) throw new Error("Sign in to manage saved clips");
      const { clearExports } = await import("@/lib/export-history");
      await clearExports(session.user.id);
      for (const item of history) { if (item.exportUrl) URL.revokeObjectURL(item.exportUrl); }
      clearHistory();
    } catch (error) { setHistoryError(error instanceof Error ? error.message : "Could not clear history"); }
    finally { setBusy(false); }
  };

  const handleDownload = async (item: ClipHistoryItem) => {
    setHistoryError("");
    try {
      if (!item.exportUrl) throw new Error("Clip is unavailable");
      const response = await fetch(item.exportUrl);
      if (!response.ok) throw new Error("Clip is unavailable");
      const { downloadBlob } = await import("@/lib/download-settings");
      await downloadBlob(await response.blob(), item.exportFileName || `clipmeme-${item.id}.mp4`);
    } catch (error) { setHistoryError(error instanceof Error ? error.message : "Download failed"); }
  };

  const handleOpenSavedClip = async (item: ClipHistoryItem) => {
    setHistoryError("");
    try {
      if (!item.exportUrl) throw new Error("Clip is unavailable");
      const response = await fetch(item.exportUrl);
      if (!response.ok) throw new Error("Clip is unavailable");
      const blob = await response.blob();
      const name = item.exportFileName || `clipmeme-${item.id}.mp4`;
      clearSource();
      useStore.setState({ overlays: [], selectedOverlayId: null, aspectRatio: item.aspectRatio });
      setSource(new File([blob], name, { type: blob.type }), URL.createObjectURL(blob), name);
    } catch (error) { setHistoryError(error instanceof Error ? error.message : "Could not open clip"); }
  };

  useEffect(() => {
    let active = true;
    setSourceClips([]);
    if (!userId) return;
    import("@/lib/clip-db").then(({ listSourceClips }) =>
      listSourceClips(userId).then(clips => { if (active) setSourceClips(clips); }).catch(console.warn)
    );
    return () => { active = false; };
  }, [userId]);

  const handleLoadSourceClip = async (clip: StoredSourceClip) => {
    const { getSourceClip } = await import("@/lib/clip-db");
    if (!userId) return;
    const stored = await getSourceClip(clip.id, userId);
    if (!stored?.blob) return;
    clearSource();
    const objectUrl = URL.createObjectURL(stored.blob);
    const file = new File([stored.blob], `${clip.title}.webm`, { type: stored.blob.type || "video/webm" });
    setSource(file, objectUrl, clip.title);
  };

  const handleDeleteSourceClip = async (id: string) => {
    const { deleteSourceClip } = await import("@/lib/clip-db");
    if (!userId) return;
    await deleteSourceClip(id, userId);
    setSourceClips((prev) => prev.filter((c) => c.id !== id));
  };

  const hasAnything = sourceClips.length > 0 || history.length > 0;

  if (!hasAnything) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full text-[#555]">
        <div className="text-3xl">📋</div>
        <p className="text-sm">No clips yet</p>
        <p className="text-xs text-[#444]">Clips from the extension appear here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-1">
      {historyError && <p role="alert" className="text-xs text-red-400">{historyError}</p>}

      {/* ── Source clips (from extension, stored in browser) ── */}
      {sourceClips.length > 0 && (
        <div>
          <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">
            Source clips · {sourceClips.length}
          </p>
          <div className="flex flex-col gap-2">
            {sourceClips.map((clip) => (
              <div
                key={clip.id}
                className="flex items-center gap-3 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg p-2 hover:border-[#444] transition-colors"
              >
                {clip.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={clip.thumbnail} alt="" className="w-14 h-10 rounded object-cover bg-[#111] shrink-0" />
                ) : (
                  <div className="w-14 h-10 rounded bg-[#111] flex items-center justify-center text-[#444] text-xs shrink-0">
                    🎬
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#ccc] font-semibold truncate">{clip.title}</div>
                  <div className="text-[10px] text-[#555]">
                    {clip.duration > 0 ? formatTime(clip.duration) : "—"} · {new Date(clip.savedAt).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <button
                    onClick={() => handleLoadSourceClip(clip)}
                    className="text-[10px] text-[#666] hover:text-[#4caf50] transition-colors"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => handleDeleteSourceClip(clip.id)}
                    className="text-[10px] text-[#666] hover:text-[#ef5350] transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Export history ── */}
      {history.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider">
              Saved clips · {history.length}
            </p>
            <button disabled={busy || exporting} onClick={() => void handleClearHistory()} className="text-[10px] text-[#555] hover:text-[#ef5350]">
              Clear
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg p-2 hover:border-[#444] transition-colors"
              >
                {item.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnail} alt="" className="w-14 h-10 rounded object-cover bg-[#111] shrink-0" />
                ) : (
                  <div className="w-14 h-10 rounded bg-[#111] flex items-center justify-center text-[#444] text-xs shrink-0">
                    🎬
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#ccc] font-semibold">
                    {item.duration.toFixed(1)}s · {item.aspectRatio}
                  </div>
                  <div className="text-[10px] text-[#555]">
                    {item.mode} · {new Date(item.exportedAt).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <button
                    disabled={exporting}
                    onClick={() => void handleOpenSavedClip(item)}
                    className="text-[10px] text-[#666] hover:text-[#ff4444] transition-colors"
                  >
                    Open clip
                  </button>
                  {item.exportUrl && (
                    <button onClick={() => void handleDownload(item)} title="Download clip" className="flex items-center gap-1 text-[10px] text-[#aaa] hover:text-[#4caf50] transition-colors">
                      <Download size={12} /> Download
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

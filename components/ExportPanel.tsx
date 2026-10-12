import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import type { AspectRatio, ClipHistoryItem } from "@/lib/types";
import InstagramPanel from "@/components/Social/InstagramPanel";
import { Camera, Send } from "lucide-react";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onExport: () => Promise<ClipHistoryItem | undefined>;
  onExportQueued?: () => void;
}

const RATIOS: { id: AspectRatio; label: string; icon: string }[] = [
  { id: "9:16", label: "9:16", icon: "📱" },
  { id: "1:1", label: "1:1", icon: "⬜" },
  { id: "16:9", label: "16:9", icon: "🖥" },
];

type DirectoryPickerWindow = Window & {
  showDirectoryPicker: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

export default function ExportPanel({ onExport, onExportQueued }: Props) {
  const [dirName, setDirName] = useState<string | null>(null);
  const [pickerSupported] = useState(() =>
    typeof window !== "undefined" && "showDirectoryPicker" in window
  );

  useEffect(() => {
    import("@/lib/download-settings").then(({ getDownloadDir }) =>
      getDownloadDir().then((h) => setDirName(h?.name ?? null)).catch(() => {})
    );
  }, []);

  const handlePickDir = async () => {
    try {
      const { setDownloadDir } = await import("@/lib/download-settings");
      const handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({ mode: "readwrite" });
      await setDownloadDir(handle);
      setDirName(handle.name);
    } catch {
      // User cancelled — do nothing
    }
  };

  const handleClearDir = async () => {
    const { clearDownloadDir } = await import("@/lib/download-settings");
    await clearDownloadDir();
    setDirName(null);
  };

  const aspectRatio = useStore((s) => s.aspectRatio);
  const setAspectRatio = useStore((s) => s.setAspectRatio);
  const queuedSegments = useStore((s) => s.queuedSegments);
  const exporting = useStore((s) => s.exporting);
  const exportProgress = useStore((s) => s.exportProgress);
  const clip = useStore((s) => s.clip);
  const sourceObjectURL = useStore((s) => s.sourceObjectURL);
  const sourceDuration = useStore((s) => s.sourceDuration);
  const overlays = useStore((s) => s.overlays);
  const muteAudio = useStore((s) => s.muteAudio);
  const setMuteAudio = useStore((s) => s.setMuteAudio);
  const fillMode = useStore((s) => s.fillMode);
  const setFillMode = useStore((s) => s.setFillMode);
  const cropZoom = useStore((s) => s.cropZoom);
  const setCropZoom = useStore((s) => s.setCropZoom);

  const duration = clip.outPoint - clip.inPoint;
  const isLive = !isFinite(duration);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Aspect ratio */}
      <div>
        <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">Format</p>
        <div className="flex gap-1.5">
          {RATIOS.map((r) => (
            <button
              key={r.id}
              onClick={() => setAspectRatio(r.id)}
              className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                aspectRatio === r.id
                  ? "bg-[#ff4444]/10 border-[#ff4444] text-white"
                  : "bg-[#111] border-[#1e1e1e] text-[#666] hover:border-[#2e2e2e]"
              }`}
            >
              <div>{r.icon}</div>
              <div>{r.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Fill mode — only relevant for 9:16 where source is likely 16:9 */}
      {aspectRatio === "9:16" && (
        <div>
          <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">Fill Mode</p>
          <div className="flex gap-1.5">
            {(["letterbox", "crop"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setFillMode(m)}
                className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  fillMode === m
                    ? "bg-[#ff4444]/10 border-[#ff4444] text-white"
                    : "bg-[#111] border-[#1e1e1e] text-[#666] hover:border-[#2e2e2e]"
                }`}
              >
                <div>{m === "letterbox" ? "🌫" : "✂"}</div>
                <div>{m === "letterbox" ? "Blur fill" : "Crop fill"}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Crop zoom slider — only for 9:16 crop fill */}
      {aspectRatio === "9:16" && fillMode === "crop" && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider">Zoom</p>
            <span className="text-[10px] text-[#666] font-mono">{Math.round(cropZoom * 100)}%</span>
          </div>
          <div
            className="relative w-full h-5 flex items-center cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setCropZoom(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
            }}
            onPointerMove={(e) => {
              if (e.buttons !== 1) return;
              const rect = e.currentTarget.getBoundingClientRect();
              setCropZoom(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
            }}
          >
            <div className="w-full h-1.5 bg-[#2a2a2a] rounded-full">
              <div className="h-full bg-[#ff4444] rounded-full" style={{ width: `${cropZoom * 100}%` }} />
            </div>
            <div
              className="absolute w-4 h-4 bg-white rounded-full shadow-lg border border-[#ff4444] -translate-x-1/2"
              style={{ left: `${cropZoom * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-[#444] mt-1">
            <span>Blur fill</span>
            <span>Full crop</span>
          </div>
        </div>
      )}

      {/* Audio toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#666]">Original audio</span>
        <button
          onClick={() => setMuteAudio(!muteAudio)}
          className={`relative w-10 h-5 rounded-full transition-colors ${muteAudio ? "bg-[#2a2a2a]" : "bg-[#ff4444]"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${muteAudio ? "left-0.5" : "left-5"}`} />
        </button>
      </div>

      {/* Clip info */}
      <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-3 text-xs text-[#666] space-y-1">
        <div className="flex justify-between">
          <span>Duration</span>
          <span className="text-[#aaa] font-mono">{isLive ? "—" : `${duration.toFixed(1)}s`}</span>
        </div>
        <div className="flex justify-between">
          <span>Overlays</span>
          <span className="text-[#aaa]">{overlays.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Resolution</span>
          <span className="text-[#aaa]">
            {aspectRatio === "9:16" ? "1080×1920" : aspectRatio === "1:1" ? "1080×1080" : "1920×1080"}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Est. file size</span>
          <span className="text-[#aaa]">{isLive ? "—" : `~${Math.round(duration * 0.8)}MB`}</span>
        </div>
      </div>

      {/* Live stream hint */}
      {isLive && (
        <div className="px-3 py-2 bg-[#1a1200] border border-[#ffca28]/30 rounded-lg text-[10px] text-[#ffca28]">
          Use <strong>Grab last Ns</strong> in the capture bar above to save a clip, then export it here.
        </div>
      )}

      {/* Export progress */}
      {exporting && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-[#aaa]">Rendering…</span>
            <span className="text-[#ff4444] font-mono">{Math.round(exportProgress)}%</span>
          </div>
          <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#ff4444] rounded-full transition-all"
              style={{ width: `${exportProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Download location */}
      {pickerSupported && (
        <div>
          <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">Save to</p>
          <div className="flex items-center gap-2 bg-[#111] border border-[#1e1e1e] rounded-lg px-3 py-2">
            <span className="text-[11px] text-[#888] flex-1 truncate">
              {dirName ? `📁 ${dirName}` : "📥 Browser downloads"}
            </span>
            {dirName ? (
              <button
                onClick={handleClearDir}
                className="text-[10px] text-[#555] hover:text-[#ef5350] transition-colors shrink-0"
                title="Reset to browser default"
              >
                ✕
              </button>
            ) : null}
            <button
              onClick={handlePickDir}
              className="text-[10px] text-[#666] hover:text-[#4caf50] transition-colors shrink-0"
            >
              Change
            </button>
          </div>
        </div>
      )}

      {/* Export + direct post actions */}
      <InstagramPanel
        renderCurrent={onExport}
        canRender={!!sourceObjectURL && sourceDuration > 0 && duration >= 1 && !isLive && !exporting}
        renderPrimaryAction={({ connected, canPost, working, onConnect, onPublish }) => (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={onExport}
              disabled={exporting || !sourceObjectURL || sourceDuration <= 0 || duration < 1 || isLive}
              className="min-w-0 py-3 bg-[#ff4444] hover:bg-[#ee3333] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-bold text-sm transition-colors"
            >
              {exporting ? "Rendering…" : isLive ? "Grab clip" : "Save to History"}
            </button>
            <button
              onClick={connected ? onPublish : onConnect}
              disabled={working || (connected && !canPost)}
              className="min-w-0 flex items-center justify-center gap-1.5 py-3 bg-[#111] border border-[#2e2e2e] hover:border-[#ff4444] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white font-bold text-sm transition-colors"
              title={connected ? "Post current edit to Instagram" : "Connect Instagram"}
            >
              {connected ? <Send size={15} /> : <Camera size={15} />}
              <span className="text-xs">{connected ? "Post to Instagram" : "Connect Instagram"}</span>
            </button>
          </div>
        )}
      />

      {/* Stitch queued segments */}
      {queuedSegments.length > 0 && onExportQueued && (
        <button
          onClick={onExportQueued}
          disabled={exporting}
          className="w-full py-3 bg-[#1a1200] border border-[#ffca28]/50 hover:border-[#ffca28] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-[#ffca28] font-bold text-sm transition-colors"
        >
          {exporting ? "Rendering…" : `Stitch & Save ${queuedSegments.length} clips`}
        </button>
      )}

    </div>
  );
}

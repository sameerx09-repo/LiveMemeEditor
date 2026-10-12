import { useStore } from "@/lib/store";
import { clamp } from "@/lib/utils";

export default function QuickClipBar() {
  const clip = useStore((s) => s.clip);
  const setClip = useStore((s) => s.setClip);
  const currentTime = useStore((s) => s.currentTime);
  const sourceDuration = useStore((s) => s.sourceDuration);
  const suggestions = useStore((s) => s.suggestions);
  const setActiveTool = useStore((s) => s.setActiveTool);
  const overlays = useStore((s) => s.overlays);
  const queuedSegments = useStore((s) => s.queuedSegments);
  const queueSegment = useStore((s) => s.queueSegment);
  const clearQueuedSegments = useStore((s) => s.clearQueuedSegments);
  const removeQueuedSegment = useStore((s) => s.removeQueuedSegment);

  const clipLast = (seconds: number) => {
    const out = clamp(currentTime, seconds, sourceDuration);
    const inPt = clamp(out - seconds, 0, out - 3);
    setClip({ inPoint: inPt, outPoint: out });
  };

  const clipFromSpike = () => {
    if (suggestions.length === 0) return;
    const nearest = suggestions.reduce((best, s) =>
      Math.abs(s.start - currentTime) < Math.abs(best.start - currentTime) ? s : best
    );
    setClip({ inPoint: nearest.start, outPoint: nearest.end });
  };

  const duration = clip.outPoint - clip.inPoint;
  const isLive = !isFinite(sourceDuration);

  const dispatchGrab = (secs: number) => {
    window.dispatchEvent(new CustomEvent("clipmeme:grab-last", { detail: { seconds: secs } }));
  };

  const handleQueue = () => {
    if (!isFinite(duration) || duration < 1) return;
    // Deep-clone overlays so future edits don't mutate this snapshot
    queueSegment({
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      overlays: overlays.map((o) => ({ ...o })),
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-[#555] font-semibold uppercase tracking-wider">
          {isLive ? "Grab from buffer:" : "Quick clip:"}
        </span>
        {[5, 10, 15, 30].map((s) => (
          <button
            key={s}
            onClick={() => isLive ? dispatchGrab(s) : clipLast(s)}
            title={isLive ? `Grab the last ${s}s from the live buffer` : `Select ${s}s ending at the current playhead position`}
            className="px-3 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#ff4444] hover:text-[#ff4444] rounded-md text-[11px] text-[#bbb] font-semibold transition-colors"
          >
            {isLive ? `Grab ${s}s` : `${s}s`}
          </button>
        ))}
        {suggestions.length > 0 && (
          <button
            onClick={clipFromSpike}
            className="px-3 py-1.5 bg-[#1a1a1a] border border-[#ffca28]/40 hover:border-[#ffca28] rounded-md text-[11px] text-[#ffca28] font-semibold transition-colors"
          >
            🟡 From suggestion
          </button>
        )}

        {/* Queue button — only for regular (non-live) video */}
        {!isLive && (
          <button
            onClick={handleQueue}
            disabled={!isFinite(duration) || duration < 1}
            title="Add current clip selection to the export queue"
            className="px-3 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#ffca28] hover:text-[#ffca28] disabled:opacity-30 disabled:cursor-not-allowed rounded-md text-[11px] text-[#888] font-semibold transition-colors"
          >
            📎 Queue{queuedSegments.length > 0 ? ` (${queuedSegments.length})` : ""}
          </button>
        )}

        {isLive ? (
          <button
            onClick={() => dispatchGrab(10)}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-[#ff4444] hover:bg-[#ee3333] rounded-lg text-white text-sm font-bold transition-colors"
          >
            ⚡ Grab 10s
            <kbd className="text-[10px] bg-white/20 px-1 py-0.5 rounded">C</kbd>
          </button>
        ) : (
          <button
            onClick={() => setActiveTool("cut")}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-[#ff4444] hover:bg-[#ee3333] rounded-lg text-white text-sm font-bold transition-colors"
          >
            ✂ Clip {duration > 0 && isFinite(duration) ? `(${duration.toFixed(1)}s)` : ""}
            <kbd className="text-[10px] bg-white/20 px-1 py-0.5 rounded">C</kbd>
          </button>
        )}
      </div>

      {/* Queued segments row */}
      {queuedSegments.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-2 py-1.5 bg-[#1a1200] border border-[#ffca28]/30 rounded-lg">
          <span className="text-[10px] text-[#ffca28] font-semibold shrink-0">
            {queuedSegments.length} clip{queuedSegments.length > 1 ? "s" : ""} queued:
          </span>
          {queuedSegments.map((seg, i) => {
            const textCount = seg.overlays.filter((o) => o.type === "text" && o.text).length;
            const emojiCount = seg.overlays.filter((o) => o.type === "emoji").length;
            return (
              <span
                key={i}
                className="flex items-center gap-1 px-2 py-0.5 bg-[#2a1f00] border border-[#ffca28]/20 rounded text-[10px] text-[#aaa]"
                title={`Clip ${i + 1}: ${(seg.outPoint - seg.inPoint).toFixed(1)}s${textCount ? `, ${textCount} text` : ""}${emojiCount ? `, ${emojiCount} emoji` : ""}`}
              >
                {(seg.outPoint - seg.inPoint).toFixed(1)}s
                {(textCount > 0 || emojiCount > 0) && (
                  <span className="text-[#ffca28] ml-0.5">
                    {textCount > 0 && `T${textCount}`}{emojiCount > 0 && `E${emojiCount}`}
                  </span>
                )}
                <button
                  onClick={() => removeQueuedSegment(i)}
                  className="text-[#555] hover:text-[#ff4444] leading-none ml-0.5"
                >
                  ×
                </button>
              </span>
            );
          })}
          <button
            onClick={clearQueuedSegments}
            className="ml-auto text-[10px] text-[#555] hover:text-[#888] px-2 py-0.5 border border-[#333] rounded"
          >
            Clear all
          </button>
          <span className="text-[10px] text-[#555]">→ hit Export in the panel →</span>
        </div>
      )}
    </div>
  );
}

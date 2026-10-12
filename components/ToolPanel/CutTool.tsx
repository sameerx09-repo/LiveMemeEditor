import { useStore } from "@/lib/store";
import { formatTime, clamp } from "@/lib/utils";

export default function CutTool() {
  const clip = useStore((s) => s.clip);
  const setClip = useStore((s) => s.setClip);
  const sourceDuration = useStore((s) => s.sourceDuration);
  const currentTime = useStore((s) => s.currentTime);

  const duration = clip.outPoint - clip.inPoint;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-4">
        <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-3">Clip Range</p>

        <div className="flex items-center gap-4 mb-3">
          <div className="flex-1 text-center">
            <div className="text-[10px] text-[#555] mb-1">IN POINT</div>
            <div className="text-lg font-bold text-[#ff4444] font-mono">
              {formatTime(clip.inPoint)}
            </div>
            <button
              onClick={() => setClip({ inPoint: clamp(currentTime, 0, clip.outPoint - 3) })}
              className="mt-1 text-[10px] text-[#444] hover:text-[#ff4444] transition-colors"
            >
              Set to now <kbd className="text-[9px] bg-[#222] border border-[#333] px-1 rounded">[</kbd>
            </button>
          </div>

          <div className="text-center">
            <div className="text-xl font-black text-white">{duration.toFixed(1)}s</div>
            <div className="text-[10px] text-[#555]">duration</div>
          </div>

          <div className="flex-1 text-center">
            <div className="text-[10px] text-[#555] mb-1">OUT POINT</div>
            <div className="text-lg font-bold text-[#ff4444] font-mono">
              {formatTime(clip.outPoint)}
            </div>
            <button
              onClick={() => setClip({ outPoint: clamp(currentTime, clip.inPoint + 3, sourceDuration) })}
              className="mt-1 text-[10px] text-[#444] hover:text-[#ff4444] transition-colors"
            >
              Set to now <kbd className="text-[9px] bg-[#222] border border-[#333] px-1 rounded">]</kbd>
            </button>
          </div>
        </div>

        {/* In-point slider */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#555] w-6">In</span>
            <input
              type="range"
              min={0}
              max={sourceDuration}
              step={0.1}
              value={clip.inPoint}
              onChange={(e) => setClip({ inPoint: clamp(Number(e.target.value), 0, clip.outPoint - 3) })}
              className="flex-1 h-1 accent-[#ff4444]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#555] w-6">Out</span>
            <input
              type="range"
              min={0}
              max={sourceDuration}
              step={0.1}
              value={clip.outPoint}
              onChange={(e) => setClip({ outPoint: clamp(Number(e.target.value), clip.inPoint + 3, sourceDuration) })}
              className="flex-1 h-1 accent-[#ff4444]"
            />
          </div>
        </div>
      </div>

      <div className="bg-[#111] border border-[#1e1e1e] rounded-xl p-4">
        <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">Keyboard Shortcuts</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Space", "Play / Pause"],
            ["[", "Set in-point"],
            ["]", "Set out-point"],
            ["← →", "Skip 5 seconds"],
            ["C", "Clip & edit"],
          ].map(([key, label]) => (
            <div key={key} className="flex items-center gap-2 text-[11px] text-[#666]">
              <kbd className="bg-[#222] border border-[#333] text-[#888] px-1.5 py-0.5 rounded text-[10px] font-mono">{key}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

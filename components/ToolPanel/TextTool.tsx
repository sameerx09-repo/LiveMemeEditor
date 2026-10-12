import { useStore } from "@/lib/store";
import { generateId } from "@/lib/utils";
import type { TextPreset, Overlay } from "@/lib/types";

const PRESETS: { id: TextPreset; label: string; preview: string; style: string }[] = [
  { id: "CAPTION", label: "Caption", preview: "White · bottom-third", style: "text-white font-bold" },
  { id: "IMPACT", label: "Impact", preview: "All-caps · outline · large", style: "text-white font-black uppercase" },
  { id: "QUOTE", label: "Quote", preview: "Serif · centered · elegant", style: "text-white italic" },
  { id: "SUBTITLE", label: "Subtitle", preview: "Small · pill background", style: "text-white text-sm bg-black/60" },
  { id: "HEADLINE", label: "Headline", preview: "Bold sans · top-of-frame", style: "text-white font-extrabold" },
];

const COLORS = ["#ffffff", "#ffca28", "#ff4444", "#4caf50", "#2196f3", "#ff9800", "#e91e63", "#000000"];

export default function TextTool() {
  const addOverlay = useStore((s) => s.addOverlay);
  const overlays = useStore((s) => s.overlays);
  const updateOverlay = useStore((s) => s.updateOverlay);
  const removeOverlay = useStore((s) => s.removeOverlay);
  const selectedId = useStore((s) => s.selectedOverlayId);
  const selectOverlay = useStore((s) => s.selectOverlay);

  const textOverlays = overlays.filter((o) => o.type === "text");
  const selected = overlays.find((o) => o.id === selectedId && o.type === "text");
  const selectedBlur = overlays.find((o) => o.id === selectedId && o.type === "blur");

  const addBlurRegion = () => {
    const o: Overlay = {
      id: generateId(),
      type: "blur",
      x: 0.15,
      y: 0.07,
      width: 0.2,
      height: 0.07,
      rotation: 0,
      opacity: 0.85,
    };
    addOverlay(o);
    selectOverlay(o.id);
  };

  const addText = (preset: TextPreset) => {
    const o: Overlay = {
      id: generateId(),
      type: "text",
      x: 0.5,
      y: preset === "HEADLINE" ? 0.1 : preset === "SUBTITLE" ? 0.9 : 0.8,
      width: 0.8,
      height: 0.1,
      rotation: 0,
      text: "",
      preset,
      color: "#ffffff",
    };
    addOverlay(o);
    selectOverlay(o.id);
  };

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-1">
      <div>
        <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">Blur Region</p>
        <button
          onClick={addBlurRegion}
          className="w-full flex items-center justify-between px-3 py-2 bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#ff4444] rounded-lg text-left transition-colors group mb-3"
        >
          <div>
            <div className="text-xs font-semibold text-[#ccc] group-hover:text-white">Blur / Censor</div>
            <div className="text-[10px] text-[#555]">Hide watermarks or faces</div>
          </div>
          <span className="text-[10px] text-[#444] group-hover:text-[#ff4444]">+ Add</span>
        </button>
      </div>

      {selectedBlur && (
        <div className="border border-[#2e2e2e] rounded-lg p-3 bg-[#1a1a1a] flex flex-col gap-3">
          <div>
            <div className="flex justify-between text-[10px] mb-2">
              <span className="text-[#555] font-bold uppercase tracking-wider">Opacity</span>
              <span className="text-[#ff4444] font-semibold">{Math.round((selectedBlur.opacity ?? 0.85) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={selectedBlur.opacity ?? 0.85}
              onChange={(e) => updateOverlay(selectedBlur.id, { opacity: parseFloat(e.target.value) })}
              style={{ width: "100%", "--pct": `${((selectedBlur.opacity ?? 0.85) - 0.1) / 0.9 * 100}%` } as React.CSSProperties}
            />
            <p className="text-[9px] text-[#444] mt-2">Drag corners on canvas to resize</p>
          </div>
          <button
            onClick={() => { removeOverlay(selectedBlur.id); selectOverlay(null); }}
            className="text-xs text-[#ef5350] hover:text-[#ff6666] text-left"
          >
            🗑 Remove blur region
          </button>
        </div>
      )}

      <div>
        <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">Style Presets</p>
        <div className="grid grid-cols-1 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => addText(p.id)}
              className="flex items-center justify-between px-3 py-2 bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#ff4444] rounded-lg text-left transition-colors group"
            >
              <div>
                <div className="text-xs font-semibold text-[#ccc] group-hover:text-white">{p.label}</div>
                <div className="text-[10px] text-[#555]">{p.preview}</div>
              </div>
              <span className="text-[10px] text-[#444] group-hover:text-[#ff4444]">+ Add</span>
            </button>
          ))}
        </div>
      </div>

      {/* Edit selected */}
      {selected && (
        <div className="border-t border-[#1e1e1e] pt-4">
          <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">Edit Selected</p>
          <textarea
            value={selected.text || ""}
            onChange={(e) => updateOverlay(selected.id, { text: e.target.value })}
            onFocus={(e) => e.target.select()}
            rows={3}
            autoFocus
            className="w-full bg-[#111] border border-[#2e2e2e] focus:border-[#ff4444] rounded-lg px-3 py-2 text-sm text-[#ccc] outline-none resize-none"
            placeholder="Your text here…"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => updateOverlay(selected.id, { color: c })}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{
                  background: c,
                  borderColor: selected.color === c ? "#ff4444" : "#2e2e2e",
                }}
              />
            ))}
          </div>
          <button
            onClick={() => { removeOverlay(selected.id); selectOverlay(null); }}
            className="mt-3 text-xs text-[#ef5350] hover:text-[#ff6666]"
          >
            🗑 Remove text box
          </button>
        </div>
      )}

      {/* All text overlays */}
      {textOverlays.length > 0 && (
        <div className="border-t border-[#1e1e1e] pt-4">
          <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">
            Text Boxes ({textOverlays.length}/5)
          </p>
          {textOverlays.map((o) => (
            <div
              key={o.id}
              onClick={() => selectOverlay(o.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer mb-1 border transition-colors ${
                o.id === selectedId
                  ? "bg-[#ff4444]/10 border-[#ff4444]/40"
                  : "bg-[#1a1a1a] border-[#2e2e2e] hover:border-[#444]"
              }`}
            >
              <span className="text-xs text-[#888] flex-1 truncate">{o.text || "(empty)"}</span>
              <span className="text-[10px] text-[#555] bg-[#222] px-1.5 rounded">{o.preset}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

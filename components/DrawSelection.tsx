import { useRef, useState } from "react";

interface Rect { x: number; y: number; w: number; h: number; }

interface Props {
  onSelect: (rect: Rect) => void;
  onSkip: () => void;
}

export default function DrawSelection({ onSelect, onSkip }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);

  const toRelative = (e: React.MouseEvent): { x: number; y: number } => {
    const el = containerRef.current!;
    const r = el.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = toRelative(e);
    setStart(pos);
    setRect(null);
    setDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !start) return;
    const pos = toRelative(e);
    setRect({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      w: Math.abs(pos.x - start.x),
      h: Math.abs(pos.y - start.y),
    });
  };

  const handleMouseUp = () => {
    setDragging(false);
    if (rect && rect.w > 0.05 && rect.h > 0.05) {
      // Good selection
    }
  };

  const confirm = () => {
    if (rect) onSelect(rect);
    else onSkip();
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-40 cursor-crosshair select-none"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Instruction */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/80 border border-[#2e2e2e] rounded-lg px-4 py-2 text-xs text-[#ccc] text-center whitespace-nowrap pointer-events-none">
        Drag to select the <span className="text-white font-bold">video player area</span> — excludes headers, sidebars, ads
      </div>

      {/* Selection rect */}
      {rect && (
        <div
          className="absolute border-2 border-[#ff4444]"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
            background: "rgba(255,68,68,0.08)",
          }}
        />
      )}

      {/* Confirm / skip buttons */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2" onClick={(e) => e.stopPropagation()}>
        {rect && rect.w > 0.05 && (
          <button
            onClick={confirm}
            className="px-4 py-2 bg-[#ff4444] rounded-lg text-white text-xs font-bold"
          >
            Use this selection ✓
          </button>
        )}
        <button
          onClick={onSkip}
          className="px-4 py-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg text-[#888] text-xs"
        >
          Skip — use full frame
        </button>
      </div>
    </div>
  );
}

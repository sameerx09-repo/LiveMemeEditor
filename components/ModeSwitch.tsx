import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import type { Mode } from "@/lib/types";

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "podcast", label: "Podcast", icon: "🎙" },
  { id: "reality", label: "Reality", icon: "🎭" },
  { id: "sports", label: "Sports", icon: "🏏" },
];

export default function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);

  return (
    <div className="flex gap-1 bg-[#141414] border border-[#1e1e1e] rounded-lg p-1">
      {MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => setMode(m.id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
            mode === m.id
              ? "bg-[#ff4444] text-white"
              : "text-[#888] hover:text-[#ccc]"
          )}
        >
          <span>{m.icon}</span>
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

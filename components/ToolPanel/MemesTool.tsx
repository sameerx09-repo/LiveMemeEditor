import { useState } from "react";
import { useStore } from "@/lib/store";
import { generateId } from "@/lib/utils";
import type { Overlay } from "@/lib/types";

const EMOJI_LIST = [
  "😂", "💀", "🔥", "💯", "😭", "🤣", "😤", "🫡", "🤡", "💀",
  "👀", "😱", "🫢", "🙏", "😮", "🎯", "⚡", "🏆", "👑", "🎬",
  "📢", "🎙", "🍿", "☕", "🌶", "💥", "🫠", "🥹", "😩", "🤯",
];

type Tab = "emoji" | "stickers" | "templates";

// Caption meme templates for Reality mode
const CAPTION_TEMPLATES = [
  { id: "pov", label: "POV:", lines: ["POV:", "your text here"] },
  { id: "theway", label: "The way…", lines: ["The way", "your text here"] },
  { id: "namewhen", label: "[Name] when…", lines: ["Me when", "your text here"] },
  { id: "noonex", label: "No one: / Name:", lines: ["No one:", "Me: your text here"] },
  { id: "thiswhy", label: "This is why…", lines: ["This is why", "your text here"] },
  { id: "season", label: "Season badge", lines: ["Season 1, Episode 2"] },
];

// Sports templates
const SPORTS_TEMPLATES = [
  { id: "goal", label: "⚽ Goal Flash", lines: ["GOAL!"] },
  { id: "wicket", label: "🏏 Wicket!", lines: ["WICKET!"] },
  { id: "motm", label: "🏆 Moment of the Match", lines: ["MOMENT OF THE MATCH"] },
  { id: "replay", label: "⟲ Replay Badge", lines: ["⟲ REPLAY"] },
  { id: "var", label: "📺 Under Review", lines: ["UNDER REVIEW"] },
];

export default function MemesTool() {
  const [tab, setTab] = useState<Tab>("emoji");
  const [search, setSearch] = useState("");
  const addOverlay = useStore((s) => s.addOverlay);
  const removeOverlay = useStore((s) => s.removeOverlay);
  const overlays = useStore((s) => s.overlays);
  const mode = useStore((s) => s.mode);

  const addEmoji = (emoji: string) => {
    if (overlays.length >= 10) return;
    const o: Overlay = {
      id: generateId(),
      type: "emoji",
      x: 0.5,
      y: 0.5,
      width: 0.15,
      height: 0.15,
      rotation: 0,
      emoji,
    };
    addOverlay(o);
  };

  const addTemplate = (lines: string[]) => {
    lines.forEach((line, i) => {
      const o: Overlay = {
        id: generateId(),
        type: "text",
        x: 0.5,
        y: 0.15 + i * 0.12,
        width: 0.9,
        height: 0.1,
        rotation: 0,
        text: line,
        preset: i === 0 ? "IMPACT" : "CAPTION",
        color: "#ffffff",
      };
      addOverlay(o);
    });
  };

  const filtered = search
    ? EMOJI_LIST.filter((e) => e.includes(search))
    : EMOJI_LIST;

  const templates = mode === "sports" ? SPORTS_TEMPLATES : CAPTION_TEMPLATES;
  const stickerOverlays = overlays.filter((o) => o.type === "emoji" || o.type === "sticker");

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1">
      {/* Tabs */}
      <div className="flex bg-[#111] border border-[#1e1e1e] rounded-lg p-0.5 gap-0.5">
        {(["emoji", "stickers", "templates"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold capitalize transition-colors ${
              tab === t ? "bg-[#2a2a2a] text-white" : "text-[#555] hover:text-[#888]"
            }`}
          >
            {t === "emoji" ? "😂 Emoji" : t === "stickers" ? "🎭 Stickers" : "📋 Templates"}
          </button>
        ))}
      </div>

      {tab === "emoji" && (
        <>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emoji…"
            className="bg-[#111] border border-[#1e1e1e] focus:border-[#ff4444] rounded-lg px-3 py-1.5 text-xs text-[#ccc] outline-none"
          />
          <div className="grid grid-cols-6 gap-1.5">
            {filtered.map((e, i) => (
              <button
                key={i}
                onClick={() => addEmoji(e)}
                className="text-2xl p-1.5 rounded-lg bg-[#111] hover:bg-[#2a2a2a] transition-colors text-center"
                title={e}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}

      {tab === "stickers" && (
        <div className="text-xs text-[#555] text-center py-8">
          <div className="text-3xl mb-2">🎭</div>
          Sticker packs — Phase 2<br />
          <span className="text-[10px]">Reaction faces, sports icons, reality show stickers</span>
        </div>
      )}

      {tab === "templates" && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider">
            {mode === "sports" ? "Sports Templates" : "Caption Meme Templates"}
          </p>
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => addTemplate(t.lines)}
              className="flex items-center justify-between px-3 py-2.5 bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#ff4444] rounded-lg text-left transition-colors group"
            >
              <span className="text-xs text-[#ccc] group-hover:text-white">{t.label}</span>
              <span className="text-[10px] text-[#444] group-hover:text-[#ff4444]">+ Add</span>
            </button>
          ))}
        </div>
      )}

      {/* Active overlays */}
      {stickerOverlays.length > 0 && (
        <div className="border-t border-[#1e1e1e] pt-3 mt-auto">
          <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">
            Active ({stickerOverlays.length}/10)
          </p>
          <div className="flex flex-wrap gap-2">
            {stickerOverlays.map((o) => (
              <div key={o.id} className="flex items-center gap-1 bg-[#1a1a1a] border border-[#2e2e2e] rounded-md px-2 py-1">
                <span className="text-sm">{o.emoji}</span>
                <button onClick={() => removeOverlay(o.id)} className="text-[10px] text-[#555] hover:text-[#ef5350]">×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

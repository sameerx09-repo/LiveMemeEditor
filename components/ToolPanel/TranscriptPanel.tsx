import { useStore } from "@/lib/store";
import { generateSuggestions } from "@/lib/clipSuggestions";
import { generateId } from "@/lib/utils";
import { extractAudio } from "@/lib/ffmpeg-client";
import { createClient } from "@/lib/supabase-browser";

export default function TranscriptPanel() {
  const transcript = useStore((s) => s.transcript);
  const transcribing = useStore((s) => s.transcribing);
  const setTranscribing = useStore((s) => s.setTranscribing);
  const setTranscript = useStore((s) => s.setTranscript);
  const setSuggestions = useStore((s) => s.setSuggestions);
  const currentTime = useStore((s) => s.currentTime);
  const setClip = useStore((s) => s.setClip);
  const suggestions = useStore((s) => s.suggestions);
  const sourceFile = useStore((s) => s.sourceFile);
  const addOverlay = useStore((s) => s.addOverlay);
  const removeOverlay = useStore((s) => s.removeOverlay);
  const overlays = useStore((s) => s.overlays);

  const handleAddSubtitles = () => {
    // Remove existing timed subtitle overlays, then add fresh ones for all segments
    overlays.filter((o) => o.startTime !== undefined).forEach((o) => removeOverlay(o.id));
    transcript.forEach((seg) => {
      addOverlay({
        id: generateId(),
        type: "text",
        preset: "SUBTITLE",
        text: seg.text,
        x: 0.5,
        y: 0.88,
        width: 0.85,
        height: 0.07,
        rotation: 0,
        color: "#ffffff",
        startTime: seg.start,
        endTime: seg.end,
      });
    });
  };

  const handleTranscribe = async () => {
    if (!sourceFile) return;
    setTranscribing(true);
    try {
      // Extract audio client-side (saves server from running ffmpeg)
      const audioBlob = await extractAudio(sourceFile);
      if (audioBlob.size > 4 * 1024 * 1024) throw new Error("Audio exceeds the hosted transcription limit of 4 MB; use a shorter clip");
      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.mp3");
      const { data: { session } } = await createClient().auth.getSession();
      const authHeaders: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const res = await fetch("/api/transcribe", { method: "POST", body: formData, headers: authHeaders });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Error ${res.status}`);
      }
      const data = await res.json();
      if (data.segments) {
        setTranscript(data.segments);
        setSuggestions(generateSuggestions(data.segments));
      }
    } catch (err) {
      console.error("Transcription failed:", err);
      alert(`Transcription failed: ${(err as Error).message}`);
    } finally {
      setTranscribing(false);
    }
  };

  if (transcribing) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full text-[#555]">
        <div className="text-3xl animate-spin">⟳</div>
        <p className="text-sm">Transcribing audio…</p>
        <p className="text-xs text-[#444]">This takes 30–60s for a long episode</p>
      </div>
    );
  }

  if (transcript.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-full text-[#555]">
        <div className="text-3xl">🎙</div>
        <p className="text-sm">No transcript yet</p>
        <button
          onClick={handleTranscribe}
          disabled={!sourceFile}
          className="px-4 py-2 bg-[#ff4444] hover:bg-[#ee3333] disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-white text-xs font-semibold transition-colors"
        >
          {sourceFile ? "Transcribe audio" : "Load a video first"}
        </button>
        <p className="text-[10px] text-[#444] text-center">Takes 30–60s · uses Whisper AI</p>
      </div>
    );
  }

  const suggestionIds = new Set(suggestions.map((s) => s.segmentId));

  return (
    <div className="flex flex-col gap-2 h-full overflow-y-auto pr-1">
      <div className="flex gap-1.5 shrink-0">
        <button
          onClick={handleTranscribe}
          disabled={!sourceFile}
          className="flex-1 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#ff4444] hover:text-[#ff4444] disabled:opacity-30 rounded-lg text-[10px] text-[#666] font-semibold transition-colors"
        >
          ↺ Re-transcribe
        </button>
        <button
          onClick={handleAddSubtitles}
          title="Burn subtitles into exported clip"
          className="flex-1 py-1.5 bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#ffca28] hover:text-[#ffca28] rounded-lg text-[10px] text-[#666] font-semibold transition-colors"
        >
          CC Add to clip
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="bg-[#1a2a1a] border border-[#2d4a2d] rounded-lg p-2 mb-1">
          <p className="text-[10px] text-[#4caf50] font-bold uppercase tracking-wider mb-1.5">
            🟡 {suggestions.length} Suggested clips
          </p>
          {suggestions.slice(0, 3).map((s) => (
            <button
              key={s.segmentId}
              onClick={() => setClip({ inPoint: s.start, outPoint: s.end })}
              className="w-full text-left text-[11px] text-[#aaa] hover:text-white border border-[#2d4a2d] hover:border-[#4caf50] bg-[#111] rounded-md px-2 py-1.5 mb-1 transition-colors"
            >
              <span className="text-[#4caf50] text-[9px] font-bold mr-1">{s.reason}</span>
              {s.text.slice(0, 80)}{s.text.length > 80 ? "…" : ""}
            </button>
          ))}
        </div>
      )}

      {transcript.map((seg) => {
        const isActive = currentTime >= seg.start && currentTime <= seg.end;
        const isSuggested = suggestionIds.has(seg.id);
        return (
          <button
            key={seg.id}
            onClick={() => setClip({ inPoint: seg.start, outPoint: seg.end })}
            className={`w-full text-left px-3 py-2 rounded-lg border text-xs leading-relaxed transition-colors ${
              isActive
                ? "bg-[#ff4444]/10 border-[#ff4444]/40 text-white"
                : isSuggested
                ? "bg-[#ffca28]/5 border-[#ffca28]/20 text-[#ccc] hover:border-[#ffca28]/40"
                : "bg-[#111] border-[#1e1e1e] text-[#888] hover:border-[#2e2e2e] hover:text-[#aaa]"
            }`}
          >
            <span className="text-[9px] text-[#444] font-mono mr-2">
              {formatSeconds(seg.start)}
            </span>
            {isSuggested && <span className="text-[9px] text-[#ffca28] mr-1">🟡</span>}
            {seg.text}
          </button>
        );
      })}
    </div>
  );
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

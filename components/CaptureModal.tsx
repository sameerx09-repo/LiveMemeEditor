interface Props {
  onGetDisplayMedia: () => void;
  onClose: () => void;
}

export default function CaptureModal({ onGetDisplayMedia, onClose }: Props) {
  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-2xl p-7 w-96 max-w-full">
        <div className="text-3xl mb-3 text-center">🎥</div>
        <h2 className="text-base font-bold text-white text-center mb-2">How to capture this video?</h2>
        <p className="text-xs text-[#777] text-center mb-5 leading-relaxed">
          Streaming sites are cross-origin — we need tab access to buffer and clip them.
        </p>

        <div className="flex flex-col gap-3">
          {/* Recommended */}
          <button
            onClick={onGetDisplayMedia}
            className="p-3 text-left bg-[#111] border border-[#4caf50]/60 hover:border-[#4caf50] rounded-xl transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-[#e0e0e0]">Share this browser tab</span>
              <span className="text-[10px] text-[#4caf50] font-bold border border-[#4caf50]/50 px-1.5 py-0.5 rounded">Recommended</span>
            </div>
            <p className="text-[11px] text-[#666] leading-relaxed">
              Browser asks you to share this tab once.{" "}
              <span className="text-[#ff9800] font-semibold">Check "Also share tab audio"</span>{" "}
              in the dialog. Works for Hotstar, YouTube, SonyLIV, ZEE5.
            </p>
          </button>

          {/* Extension (placeholder) */}
          <div className="p-3 text-left bg-[#111] border border-[#2e2e2e] rounded-xl opacity-50 cursor-not-allowed">
            <div className="text-sm font-semibold text-[#888] mb-1">🧩 ClipMemeEditor Extension <span className="text-[10px] font-normal text-[#555]">— Phase 2</span></div>
            <p className="text-[11px] text-[#555]">Silent capture, auto-crops to video element, audio always included.</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full text-xs text-[#555] hover:text-[#888] transition-colors"
        >
          ← Cancel
        </button>
      </div>
    </div>
  );
}

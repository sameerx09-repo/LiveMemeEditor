import { useEffect, useRef, useCallback } from "react";
import { useStore } from "@/lib/store";
import { formatTime, clamp } from "@/lib/utils";

interface Props {
  audioBuffer: AudioBuffer | null;
}

const BAR_COUNT = 200;

export default function WaveformStrip({ audioBuffer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"in" | "out" | "select" | null>(null);
  const dragAnchor = useRef<number>(0);

  const currentTime = useStore((s) => s.currentTime);
  const sourceDuration = useStore((s) => s.sourceDuration);
  const clip = useStore((s) => s.clip);
  const setClip = useStore((s) => s.setClip);
  const sceneCuts = useStore((s) => s.sceneCuts);
  const suggestions = useStore((s) => s.suggestions);

  // Refs so mouse handlers always read fresh values without stale closures
  const clipRef = useRef(clip);
  const sourceDurationRef = useRef(sourceDuration);
  useEffect(() => { clipRef.current = clip; }, [clip]);
  useEffect(() => { sourceDurationRef.current = sourceDuration; }, [sourceDuration]);

  // Compute waveform peaks from audio buffer
  const peaks = useRef<number[]>([]);
  useEffect(() => {
    if (!audioBuffer) {
      peaks.current = Array.from({ length: BAR_COUNT }, () => 0);
      return;
    }
    const data = audioBuffer.getChannelData(0);
    const blockSize = Math.floor(data.length / BAR_COUNT);
    peaks.current = Array.from({ length: BAR_COUNT }, (_, i) => {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) sum += Math.abs(data[i * blockSize + j]);
      return sum / blockSize;
    });
    const max = Math.max(...peaks.current, 0.001);
    peaks.current = peaks.current.map((v) => v / max);
  }, [audioBuffer]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dur = sourceDuration || 1;
    const toX = (t: number) => (t / dur) * w;
    const hasSource = sourceDuration > 0;
    const inX = hasSource ? toX(clip.inPoint) : 0;
    const outX = hasSource ? toX(clip.outPoint) : 0;
    const playX = hasSource ? toX(currentTime) : 0;

    // Selection fill
    if (hasSource) {
      // Dim unselected regions
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, inX, h);
      ctx.fillRect(outX, 0, w - outX, h);
      // Highlight selected region
      ctx.fillStyle = "rgba(255,68,68,0.18)";
      ctx.fillRect(inX, 0, outX - inX, h);
    }

    // Waveform bars
    const barW = Math.max(1, w / BAR_COUNT - 1);
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = (i / BAR_COUNT) * w;
      const amp = peaks.current[i] || 0;
      if (amp === 0 && !hasSource) continue;
      const barH = Math.max(2, amp * h * 0.85);
      const inClip = hasSource && x >= inX && x <= outX;
      ctx.fillStyle = inClip ? "#ff4444" : "#2a2a2a";
      ctx.fillRect(x, (h - barH) / 2, barW, barH);
    }

    // Scene cut markers
    sceneCuts.forEach(({ timestamp }) => {
      const x = toX(timestamp);
      ctx.fillStyle = "#ffffff44";
      ctx.fillRect(x - 1, 0, 2, h);
    });

    // Suggestion markers
    suggestions.forEach((s) => {
      const x = toX(s.start);
      ctx.fillStyle = "#ffca2888";
      ctx.beginPath();
      ctx.arc(x, h - 6, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    if (hasSource) {
      // In-point handle
      ctx.fillStyle = "#ff4444";
      ctx.fillRect(inX - 2, 0, 4, h);
      roundRect(ctx, inX - 12, h / 2 - 12, 12, 24, 3);
      ctx.fill();
      // In-point time label
      ctx.fillStyle = "#ff4444";
      roundRect(ctx, Math.max(0, inX - 18), 0, 36, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 8px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(formatTime(clip.inPoint), inX, 10);

      // Out-point handle
      ctx.fillStyle = "#ff4444";
      ctx.fillRect(outX - 2, 0, 4, h);
      roundRect(ctx, outX, h / 2 - 12, 12, 24, 3);
      ctx.fill();
      // Out-point time label
      ctx.fillStyle = "#ff4444";
      roundRect(ctx, Math.min(w - 36, outX - 18), 0, 36, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 8px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(formatTime(clip.outPoint), outX, 10);

      // Playhead
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(playX - 1, 0, 2, h);
      ctx.beginPath();
      ctx.moveTo(playX - 5, 0);
      ctx.lineTo(playX + 5, 0);
      ctx.lineTo(playX, 8);
      ctx.closePath();
      ctx.fill();
    }

    // Duration label on clip selection
    if (hasSource && clip.outPoint > clip.inPoint) {
      const dur2 = clip.outPoint - clip.inPoint;
      const midX = (inX + outX) / 2;
      ctx.fillStyle = "#ff4444";
      roundRect(ctx, midX - 18, 4, 36, 16, 4);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(`${dur2.toFixed(1)}s`, midX, 15);
    }
  }, [currentTime, sourceDuration, clip, sceneCuts, suggestions]);

  const getTimeFromX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || sourceDuration === 0) return 0;
    const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
    return pct * sourceDuration;
  }, [sourceDuration]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const t = getTimeFromX(e.clientX);
    const inX = (clip.inPoint / (sourceDuration || 1)) * (containerRef.current?.clientWidth || 1);
    const outX = (clip.outPoint / (sourceDuration || 1)) * (containerRef.current?.clientWidth || 1);
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (Math.abs(x - inX) < 12) dragging.current = "in";
    else if (Math.abs(x - outX) < 12) dragging.current = "out";
    else {
      dragging.current = "select";
      dragAnchor.current = t;
      setClip({ inPoint: t, outPoint: t });
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const t = getTimeFromX(e.clientX);
    const c = clipRef.current;
    const dur = sourceDurationRef.current;
    if (dragging.current === "in") {
      setClip({ inPoint: clamp(t, 0, c.outPoint - 1) });
    } else if (dragging.current === "out") {
      setClip({ outPoint: clamp(t, c.inPoint + 1, dur) });
    } else if (dragging.current === "select") {
      const anchor = dragAnchor.current;
      setClip({
        inPoint: clamp(anchor, 0, dur),
        outPoint: clamp(Math.max(anchor, t), 0, dur),
      });
    }
  }, [getTimeFromX, setClip]);

  const handleMouseUp = useCallback(() => {
    dragging.current = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] text-[#555] font-mono px-1">
        <span>0:00</span>
        <span className="text-[#444] font-semibold uppercase tracking-wider text-[9px]">
          ⏱ Timeline · drag handles to trim · 🟡 = suggested clip
        </span>
        <span>{formatTime(sourceDuration)}</span>
      </div>

      <div
        ref={containerRef}
        className="relative w-full rounded-lg overflow-hidden border border-[#1e1e1e] cursor-col-resize"
        style={{ height: 56, background: "#141414" }}
        onMouseDown={handleMouseDown}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { getAspectDimensions } from "@/lib/utils";
import { isEditorShortcutAllowed } from "@/lib/editor-shortcuts";

interface Props {
  active?: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  width: number;
}

const FONT_MAP: Record<string, string> = {
  CAPTION: "bold 18px Arial, sans-serif",
  IMPACT: "900 24px Impact, Arial Narrow, sans-serif",
  QUOTE: "italic 20px Georgia, serif",
  SUBTITLE: "600 14px Arial, sans-serif",
  HEADLINE: "800 22px Arial, sans-serif",
};

export default function PreviewCanvas({ active = true, videoRef, width }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  // anchor = normalized coords of the corner opposite to the one being dragged
  const resizeRef = useRef<{ id: string; anchorX: number; anchorY: number } | null>(null);

  const overlays = useStore((s) => s.overlays);
  const aspectRatio = useStore((s) => s.aspectRatio);
  const fillMode = useStore((s) => s.fillMode);
  const cropZoom = useStore((s) => s.cropZoom);
  const selectedOverlayId = useStore((s) => s.selectedOverlayId);
  const selectOverlay = useStore((s) => s.selectOverlay);
  const updateOverlay = useStore((s) => s.updateOverlay);
  const removeOverlay = useStore((s) => s.removeOverlay);

  // Use refs so pointer handlers always read fresh values
  const overlaysRef = useRef(overlays);
  const selectedRef = useRef(selectedOverlayId);
  useEffect(() => { overlaysRef.current = overlays; }, [overlays]);
  useEffect(() => { selectedRef.current = selectedOverlayId; }, [selectedOverlayId]);

  // Delete/Backspace key removes selected overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isEditorShortcutAllowed(e, active, useStore.getState().exporting)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        removeOverlay(selectedRef.current);
        selectOverlay(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, removeOverlay, selectOverlay]);

  const { width: cw, height: ch } = getAspectDimensions(aspectRatio, width);

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = cw;
    canvas.height = ch;

    const draw = () => {
      const video = videoRef.current;
      ctx.clearRect(0, 0, cw, ch);

      if (video && video.readyState >= 2) {
        const vw = video.videoWidth || 1;
        const vh = video.videoHeight || 1;
        const srcAspect = vw / vh;
        const dstAspect = cw / ch;

        if (aspectRatio === "9:16") {
          const scMin = Math.min(cw / vw, ch / vh);
          const scMax = Math.max(cw / vw, ch / vh);
          if (fillMode === "crop") {
            const sc = scMin + (scMax - scMin) * cropZoom;
            if (cropZoom < 1) {
              ctx.save();
              ctx.filter = "blur(20px) brightness(0.65)";
              ctx.drawImage(video, (cw - vw * scMax) / 2, (ch - vh * scMax) / 2, vw * scMax, vh * scMax);
              ctx.restore();
              ctx.filter = "none";
            }
            ctx.drawImage(video, (cw - vw * sc) / 2, (ch - vh * sc) / 2, vw * sc, vh * sc);
          } else {
            ctx.save();
            ctx.filter = "blur(20px) brightness(0.65)";
            ctx.drawImage(video, (cw - vw * scMax) / 2, (ch - vh * scMax) / 2, vw * scMax, vh * scMax);
            ctx.restore();
            ctx.filter = "none";
            const vidH = cw / srcAspect;
            ctx.drawImage(video, 0, (ch - vidH) / 2, cw, vidH);
          }
        } else if (aspectRatio === "1:1") {
          if (srcAspect > dstAspect) {
            const sw = vh * dstAspect;
            ctx.drawImage(video, (vw - sw) / 2, 0, sw, vh, 0, 0, cw, ch);
          } else {
            const sh = vw / dstAspect;
            ctx.drawImage(video, 0, (vh - sh) / 2, vw, sh, 0, 0, cw, ch);
          }
        } else {
          ctx.drawImage(video, 0, 0, cw, ch);
        }
      } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, cw, ch);
      }

      // Draw overlays (skip timed ones outside current playback time)
      overlays.forEach((o) => {
        if (o.startTime !== undefined && video &&
            (video.currentTime < o.startTime || video.currentTime > (o.endTime ?? Infinity))) return;
        const ox = o.x * cw;
        const oy = o.y * ch;
        const ow = o.width * cw;
        const oh = o.height * ch;

        // Blur region: re-draw the video patch with blur filter
        if (o.type === "blur" && video && video.readyState >= 2) {
          const rx = ox - ow / 2, ry = oy - oh / 2;
          ctx.save();
          ctx.globalAlpha = o.opacity ?? 0.85;
          ctx.filter = "blur(8px)";
          ctx.drawImage(video, rx, ry, ow, oh, rx, ry, ow, oh);
          ctx.restore();
          ctx.filter = "none";
          if (o.id === selectedOverlayId) {
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(rx, ry, ow, oh);
            ctx.setLineDash([]);
            // Corner resize handles
            const hs = 6;
            ctx.fillStyle = "#ff4444";
            [[rx, ry], [rx + ow, ry], [rx, ry + oh], [rx + ow, ry + oh]].forEach(([cx, cy]) => {
              ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
            });
          }
          return;
        }

        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate((o.rotation * Math.PI) / 180);

        if (o.type === "emoji" && o.emoji) {
          const size = o.width * cw;
          ctx.font = `${size}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(o.emoji, 0, 0);
        }

        if (o.type === "text" && o.text) {
          const preset = o.preset || "CAPTION";
          ctx.font = FONT_MAP[preset] || FONT_MAP.CAPTION;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          if (preset === "IMPACT") {
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 4;
            ctx.strokeText(o.text, 0, 0, ow);
          }
          if (preset === "SUBTITLE") {
            const metrics = ctx.measureText(o.text);
            const padX = 12, padY = 6;
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.beginPath();
            ctx.roundRect(-metrics.width / 2 - padX, -10 - padY, metrics.width + padX * 2, 20 + padY * 2, 6);
            ctx.fill();
          }
          ctx.fillStyle = o.color || "#ffffff";
          ctx.fillText(o.text, 0, 0, ow);
        }

        // Selection ring
        if (o.id === selectedOverlayId) {
          const hw = Math.max(o.width * cw / 2, 18);
          const hh = Math.max(o.height * ch / 2, 18);
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
          ctx.setLineDash([]);
        }

        ctx.restore();
      });

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef, cw, ch, overlays, aspectRatio, fillMode, cropZoom, selectedOverlayId]);

  const getCanvasPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * cw,
      y: ((e.clientY - rect.top) / rect.height) * ch,
    };
  };

  const hitTest = (cx: number, cy: number) => {
    const list = overlaysRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      const ox = o.x * cw, oy = o.y * ch;
      const hw = Math.max(o.width * cw / 2, 20);
      const hh = Math.max(o.height * ch / 2, 20);
      if (cx >= ox - hw && cx <= ox + hw && cy >= oy - hh && cy <= oy + hh) return o.id;
    }
    return null;
  };

  const HANDLE = 8; // hit radius for corner handles in canvas px

  const blurCornerHit = (x: number, y: number) => {
    const selId = selectedRef.current;
    if (!selId) return null;
    const o = overlaysRef.current.find((o) => o.id === selId && o.type === "blur");
    if (!o) return null;
    const ox = o.x * cw, oy = o.y * ch, hw = o.width * cw / 2, hh = o.height * ch / 2;
    const corners: [number, number, number, number][] = [
      // [cx, cy, anchorNX, anchorNY] — anchor is the opposite corner in normalized space
      [ox - hw, oy - hh, o.x + o.width / 2, o.y + o.height / 2], // tl → anchor br
      [ox + hw, oy - hh, o.x - o.width / 2, o.y + o.height / 2], // tr → anchor bl
      [ox - hw, oy + hh, o.x + o.width / 2, o.y - o.height / 2], // bl → anchor tr
      [ox + hw, oy + hh, o.x - o.width / 2, o.y - o.height / 2], // br → anchor tl
    ];
    for (const [cx, cy, ax, ay] of corners) {
      if (Math.abs(x - cx) <= HANDLE && Math.abs(y - cy) <= HANDLE)
        return { id: selId, anchorX: ax, anchorY: ay };
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasPos(e);
    // Check resize handle first (only for selected blur overlay)
    const corner = blurCornerHit(x, y);
    if (corner) {
      resizeRef.current = corner;
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      return;
    }
    const hitId = hitTest(x, y);
    selectOverlay(hitId);
    if (hitId) {
      const o = overlaysRef.current.find((o) => o.id === hitId)!;
      dragRef.current = { id: hitId, startX: x, startY: y, origX: o.x, origY: o.y };
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasPos(e);
    const canvas = canvasRef.current;

    if (resizeRef.current) {
      if (canvas) canvas.style.cursor = "nwse-resize";
      const { id, anchorX, anchorY } = resizeRef.current;
      const mouseNX = x / cw, mouseNY = y / ch;
      const newW = Math.max(0.04, Math.abs(mouseNX - anchorX));
      const newH = Math.max(0.02, Math.abs(mouseNY - anchorY));
      const newX = (mouseNX + anchorX) / 2;
      const newY = (mouseNY + anchorY) / 2;
      updateOverlay(id, { x: newX, y: newY, width: newW, height: newH });
    } else if (dragRef.current) {
      if (canvas) canvas.style.cursor = "grabbing";
      const dx = (x - dragRef.current.startX) / cw;
      const dy = (y - dragRef.current.startY) / ch;
      updateOverlay(dragRef.current.id, {
        x: Math.max(0.02, Math.min(0.98, dragRef.current.origX + dx)),
        y: Math.max(0.02, Math.min(0.98, dragRef.current.origY + dy)),
      });
    } else {
      const corner = blurCornerHit(x, y);
      if (canvas) canvas.style.cursor = corner ? "nwse-resize" : hitTest(x, y) ? "grab" : "default";
    }
  };

  const handlePointerUp = () => {
    resizeRef.current = null;
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "default";
  };

  const selectedOverlay = selectedOverlayId ? overlays.find((o) => o.id === selectedOverlayId) : null;

  return (
    <div style={{ position: "relative", width: cw, maxWidth: "100%", display: "inline-block" }}>
      <canvas
        ref={canvasRef}
        style={{ width: cw, height: ch, maxWidth: "100%", borderRadius: 8, display: "block" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {selectedOverlay && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => { removeOverlay(selectedOverlay.id); selectOverlay(null); }}
          title="Delete overlay (or press Delete key)"
          style={{
            position: "absolute",
            top: `calc(${selectedOverlay.y * 100}% - 28px)`,
            left: `calc(${selectedOverlay.x * 100}%)`,
            transform: "translateX(-50%)",
            background: "rgba(220,38,38,0.9)",
            border: "none",
            borderRadius: "50%",
            width: 22,
            height: 22,
            color: "#fff",
            fontSize: 13,
            lineHeight: "22px",
            textAlign: "center",
            cursor: "pointer",
            zIndex: 10,
            padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

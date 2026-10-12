import { useRef, useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";

interface Props {
  captureStream: MediaStream | null;
}

const GRAB_DURATIONS = [5, 10, 15, 30];

export default function CaptureRecorder({ captureStream }: Props) {
  const [bufferedSecs, setBufferedSecs] = useState(0);
  const [pipOpen, setPipOpen] = useState(false);
  const [hasPip, setHasPip] = useState(false);
  const [queueMode, setQueueMode] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [stitching, setStitching] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timedChunksRef = useRef<Array<{ blob: Blob; time: number }>>([]);
  const mimeTypeRef = useRef("video/webm");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pipWinRef = useRef<Window | null>(null);
  const bufferedSecsRef = useRef(0);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const queuedClipsRef = useRef<Blob[]>([]);

  const setSource = useStore((s) => s.setSource);
  const setClip = useStore((s) => s.setClip);

  useEffect(() => { captureStreamRef.current = captureStream; }, [captureStream]);
  useEffect(() => { setHasPip("documentPictureInPicture" in window); }, []);
  useEffect(() => { bufferedSecsRef.current = bufferedSecs; }, [bufferedSecs]);

  // Helper: start a fresh recorder on the current stream
  const startRecorder = useCallback((stream: MediaStream) => {
    const activeTracks = stream.getVideoTracks().filter((t) => t.readyState === "live");
    if (activeTracks.length === 0) return;
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { mimeType: mimeTypeRef.current }); }
    catch { return; }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        const now = Date.now();
        timedChunksRef.current.push({ blob: e.data, time: now });
        const cutoff = now - 120_000;
        timedChunksRef.current = timedChunksRef.current.filter((c) => c.time >= cutoff);
      }
    };
    try { recorder.start(200); } catch { return; }
    recorderRef.current = recorder;
  }, []);

  // Auto-start rolling buffer when stream appears
  useEffect(() => {
    if (!captureStream) {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      timedChunksRef.current = [];
      queuedClipsRef.current = [];
      setBufferedSecs(0);
      setQueueCount(0);
      setQueueMode(false);
      return;
    }

    const mt =
      ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t)
      ) || "video/webm";
    mimeTypeRef.current = mt;
    timedChunksRef.current = [];

    startRecorder(captureStream);
    timerRef.current = setInterval(() => setBufferedSecs((s) => Math.min(s + 1, 120)), 1000);

    return () => {
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [captureStream, startRecorder]);

  // Listen for grab events from QuickClipBar / keyboard shortcuts
  useEffect(() => {
    if (!captureStream) return;
    const handler = (e: Event) => grab((e as CustomEvent).detail?.seconds ?? 10);
    window.addEventListener("clipmeme:grab-last", handler);
    return () => window.removeEventListener("clipmeme:grab-last", handler);
  }, [captureStream, queueMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const grab = (seconds: number, all = false) => {
    const now = Date.now();
    const chunks = all
      ? timedChunksRef.current
      : timedChunksRef.current.filter((c) => c.time >= now - seconds * 1000);

    if (chunks.length === 0) {
      alert(`Not enough buffered yet (${bufferedSecsRef.current}s available). Wait and try again.`);
      return;
    }

    const blob = new Blob(chunks.map((c) => c.blob), { type: mimeTypeRef.current });

    if (queueMode) {
      // Queue clip and keep recording
      queuedClipsRef.current.push(blob);
      setQueueCount(queuedClipsRef.current.length);
      timedChunksRef.current = [];
      setBufferedSecs(0);

      const old = recorderRef.current;
      recorderRef.current = null;
      if (old?.state === "recording") {
        old.onstop = () => {
          const stream = captureStreamRef.current;
          if (stream) startRecorder(stream);
        };
        old.stop();
      }
      return;
    }

    // Normal grab: stop capture and open in editor
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    const url = URL.createObjectURL(blob);
    const file = new File([blob], `capture-${Date.now()}.webm`, { type: mimeTypeRef.current });
    setSource(file, url);
    setClip({ inPoint: 0, outPoint: all ? bufferedSecsRef.current : Math.min(seconds, bufferedSecsRef.current) });
    captureStream?.getTracks().forEach((t) => t.stop());
  };

  const stitchAndEdit = async () => {
    const clips = [...queuedClipsRef.current];
    if (clips.length === 0) return;

    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    captureStreamRef.current?.getTracks().forEach((t) => t.stop());

    if (clips.length === 1) {
      const url = URL.createObjectURL(clips[0]);
      const file = new File([clips[0]], `capture-${Date.now()}.webm`, { type: mimeTypeRef.current });
      setSource(file, url);
      setClip({ inPoint: 0, outPoint: 999 });
      queuedClipsRef.current = [];
      setQueueCount(0);
      return;
    }

    setStitching(true);
    try {
      const { stitchBlobs } = await import("@/lib/ffmpeg-client");
      const stitchedBlob = await stitchBlobs(clips);
      const url = URL.createObjectURL(stitchedBlob);
      const file = new File([stitchedBlob], `capture-stitched-${Date.now()}.mp4`, { type: "video/mp4" });
      setSource(file, url);
      setClip({ inPoint: 0, outPoint: 999 });
    } catch (err) {
      console.error("Stitch failed:", err);
      // Fallback: open first clip
      const url = URL.createObjectURL(clips[0]);
      const file = new File([clips[0]], `capture-${Date.now()}.webm`, { type: mimeTypeRef.current });
      setSource(file, url);
      setClip({ inPoint: 0, outPoint: 999 });
      alert(`Stitch failed, opening clip 1 only. Error: ${(err as Error).message}`);
    } finally {
      setStitching(false);
      queuedClipsRef.current = [];
      setQueueCount(0);
    }
  };

  const openPip = async () => {
    const pip = await (window as any).documentPictureInPicture.requestWindow({ width: 320, height: 80 });
    pipWinRef.current = pip;
    pip.document.body.style.cssText =
      "margin:0;background:#0f0f0f;display:flex;align-items:center;justify-content:center;gap:10px;font-family:system-ui;height:80px;padding:0 16px;box-sizing:border-box;";

    const label = pip.document.createElement("span");
    label.id = "buf-label";
    label.style.cssText = "color:#aaa;font-size:12px;font-weight:600;white-space:nowrap;";
    label.textContent = `${bufferedSecs}s buffered`;

    const iv = setInterval(() => {
      if (pip.closed) { clearInterval(iv); return; }
      const l = pip.document.getElementById("buf-label");
      if (l) l.textContent = `${bufferedSecsRef.current}s buffered`;
    }, 1000);

    const btn = pip.document.createElement("button");
    btn.style.cssText =
      "background:#ff4444;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;";
    btn.textContent = "⚡ Grab last 10s";
    btn.onclick = () => grab(10);

    pip.document.body.appendChild(label);
    pip.document.body.appendChild(btn);
    pip.addEventListener("pagehide", () => { clearInterval(iv); setPipOpen(false); });
    setPipOpen(true);
  };

  if (!captureStream) return null;

  const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`);

  return (
    <div className="flex flex-col gap-2">
      {/* Main capture bar */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-[#1a0000] border border-[#ff4444]/40 rounded-xl">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#ff4444] shrink-0 mr-1">
          <span className="w-2 h-2 rounded-full bg-[#ff4444] animate-pulse" />
          {fmt(bufferedSecs)} buffered
        </span>

        <span className="text-[11px] text-[#555] shrink-0">Grab last:</span>

        {GRAB_DURATIONS.map((d) => (
          <button
            key={d}
            onClick={() => grab(d)}
            disabled={bufferedSecs < d}
            title={bufferedSecs < d ? `Need ${d}s buffered (have ${bufferedSecs}s)` : `Grab last ${d}s`}
            className="px-3 py-1.5 bg-[#1e1e1e] hover:bg-[#ff4444] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border border-[#333] rounded-lg text-[11px] text-[#bbb] font-semibold transition-colors"
          >
            {d}s
          </button>
        ))}

        <div className="w-px h-4 bg-[#333] mx-0.5 shrink-0" />

        <button
          onClick={() => grab(0, true)}
          disabled={bufferedSecs === 0}
          title="Grab everything buffered so far"
          className="px-3 py-1.5 bg-[#1e1e1e] hover:bg-[#ff4444] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border border-[#333] rounded-lg text-[11px] text-[#bbb] font-semibold transition-colors"
        >
          All ({fmt(bufferedSecs)})
        </button>

        {/* Queue mode toggle */}
        <button
          onClick={() => setQueueMode((m) => !m)}
          title={queueMode ? "Queue mode ON — grabs add to queue, not editor" : "Enable queue mode to grab multiple clips"}
          className={`ml-auto px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
            queueMode
              ? "bg-[#1a1200] border-[#ffca28]/60 text-[#ffca28]"
              : "bg-[#1e1e1e] border-[#333] text-[#555] hover:text-[#888]"
          }`}
        >
          📎 Queue {queueMode && queueCount > 0 ? `(${queueCount})` : "mode"}
        </button>

        {hasPip && !pipOpen && (
          <button
            onClick={openPip}
            title="Float a Grab button so you can grab clips while watching another tab"
            className="px-2.5 py-1.5 bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#333] rounded-lg text-[10px] text-[#888] font-semibold transition-colors"
          >
            ↗ Float
          </button>
        )}
      </div>

      {/* Queue status bar */}
      {queueMode && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1200] border border-[#ffca28]/30 rounded-xl text-[11px]">
          <span className="text-[#ffca28] font-semibold">
            {queueCount === 0
              ? "Queue mode — grabs will be queued, not opened immediately"
              : `${queueCount} clip${queueCount > 1 ? "s" : ""} queued`}
          </span>
          {queueCount > 0 && (
            <>
              <button
                onClick={stitchAndEdit}
                disabled={stitching}
                className="ml-auto px-3 py-1 bg-[#ffca28] text-black font-bold rounded-lg hover:bg-[#ffe066] disabled:opacity-50 transition-colors"
              >
                {stitching ? "Stitching…" : `✂ Edit ${queueCount} clip${queueCount > 1 ? "s" : ""}`}
              </button>
              <button
                onClick={() => { queuedClipsRef.current = []; setQueueCount(0); }}
                className="px-2 py-1 text-[#555] hover:text-[#888] border border-[#333] rounded-lg"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

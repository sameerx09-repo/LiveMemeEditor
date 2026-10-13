import { useRef, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { mergeAudioVideo, stitchBlobs } from "@/lib/ffmpeg-client";
import Head from "next/head";
import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";
import { generateSuggestions } from "@/lib/clipSuggestions";
import { detectSceneCuts } from "@/lib/sceneDetection";
import { generateId, detectPlatform } from "@/lib/utils";
import type { ClipHistoryItem } from "@/lib/types";
import { createClient } from "@/lib/supabase-browser";
import UserProfile from "@/components/UserProfile";
import { isEditorShortcutAllowed } from "@/lib/editor-shortcuts";

// Dynamic imports (client-only)
const ModeSwitch = dynamic(() => import("@/components/ModeSwitch"), { ssr: false });
const VideoStage = dynamic(() => import("@/components/VideoStage"), { ssr: false });
const WaveformStrip = dynamic(() => import("@/components/WaveformStrip"), { ssr: false });
const QuickClipBar = dynamic(() => import("@/components/QuickClipBar"), { ssr: false });
const PreviewCanvas = dynamic(() => import("@/components/PreviewCanvas"), { ssr: false });
const CaptureRecorder = dynamic(() => import("@/components/CaptureRecorder"), { ssr: false });
const ExportPanel = dynamic(() => import("@/components/ExportPanel"), { ssr: false });
const CutTool = dynamic(() => import("@/components/ToolPanel/CutTool"), { ssr: false });
const TextTool = dynamic(() => import("@/components/ToolPanel/TextTool"), { ssr: false });
const MemesTool = dynamic(() => import("@/components/ToolPanel/MemesTool"), { ssr: false });
const TranscriptPanel = dynamic(() => import("@/components/ToolPanel/TranscriptPanel"), { ssr: false });
const HistoryPanel = dynamic(() => import("@/components/ToolPanel/HistoryPanel"), { ssr: false });
const ScheduleCalendar = dynamic(() => import("@/components/Social/ScheduleCalendar"), { ssr: false });

const TOOL_TABS = [
  { id: "cut", label: "✂ Cut" },
  { id: "text", label: "T Text" },
  { id: "memes", label: "😂 Memes" },
  { id: "transcript", label: "📝 Transcript" },
  { id: "history", label: "📋 History" },
] as const;

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [captureStream, setCaptureStream] = useState<MediaStream | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [detectingScenes, setDetectingScenes] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const currentUserRef = useRef<string | null>(null);
  const authRevisionRef = useRef(0);
  const [workspaceTab, setWorkspaceTab] = useState<"editor" | "schedule">("editor");

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      window.postMessage({ type: "__CLIPMEME_AUTH_CHANGED__", signedOut: event === "SIGNED_OUT" }, window.location.origin);
      const nextUser = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (currentUserRef.current && currentUserRef.current !== nextUser)) {
        ++authRevisionRef.current;
        const state = useStore.getState();
        if (state.sourceObjectURL) URL.revokeObjectURL(state.sourceObjectURL);
        for (const item of state.history) { if (item.exportUrl) URL.revokeObjectURL(item.exportUrl); }
        useStore.setState(useStore.getInitialState());
        setLoadedClipId(null);
        setAudioBuffer(null);
        setCaptureStream(previous => { previous?.getTracks().forEach(track => track.stop()); return null; });
        setUserEmail(null);
        router.replace("/login");
      }
      currentUserRef.current = nextUser;
      setUserId(nextUser);
      setUserEmail(session?.user.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Auth gate + clip loader — run together so clip load has a valid token
  useEffect(() => {
    if (typeof window === "undefined") return;
    const supabase = createClient();
    const clipId = new URLSearchParams(window.location.search).get("clip");
    let active = true;
    const revision = authRevisionRef.current;

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!active || revision !== authRevisionRef.current) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserEmail(user.email ?? null);
      currentUserRef.current = user.id;
      setUserId(user.id);
      try {
        const { listExports } = await import("@/lib/export-history");
        const saved = await listExports(user.id);
        if (!active || currentUserRef.current !== user.id || revision !== authRevisionRef.current) return;
        useStore.setState(s => ({ history: [...s.history, ...saved.filter(item => !s.history.some(existing => existing.id === item.id))] }));
      } catch (error) { console.error("Could not restore saved clips:", error); }

      if (!clipId) return;
      setClipLoading(true);

      // Get session token — available now since getUser() confirmed auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!active || currentUserRef.current !== user.id || revision !== authRevisionRef.current) return;
      const authHeaders: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      loadClip(clipId, authHeaders, user.id).catch((e) => {
        console.error("[ClipMemeEditor] clip load failed:", e);
        alert(`Could not load clip: ${e.message}`);
      }).finally(() => setClipLoading(false));
    });
    return () => { active = false; };
  }, []);

  // Store
  const mode = useStore((s) => s.mode);
  const sourceObjectURL = useStore((s) => s.sourceObjectURL);
  const sourceFile = useStore((s) => s.sourceFile);
  const activeTool = useStore((s) => s.activeTool);
  const setActiveTool = useStore((s) => s.setActiveTool);
  const setTranscript = useStore((s) => s.setTranscript);
  const setTranscribing = useStore((s) => s.setTranscribing);
  const setSuggestions = useStore((s) => s.setSuggestions);
  const setSceneCuts = useStore((s) => s.setSceneCuts);
  const setPlaying = useStore((s) => s.setPlaying);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const clip = useStore((s) => s.clip);
  const overlays = useStore((s) => s.overlays);
  const aspectRatio = useStore((s) => s.aspectRatio);
  const setExporting = useStore((s) => s.setExporting);
  const exporting = useStore((s) => s.exporting);
  const setExportProgress = useStore((s) => s.setExportProgress);
  const addToHistory = useStore((s) => s.addToHistory);
  const muteAudio = useStore((s) => s.muteAudio);
  const playing = useStore((s) => s.playing);
  const currentTime = useStore((s) => s.currentTime);
  const sourceDuration = useStore((s) => s.sourceDuration);
  const setClip = useStore((s) => s.setClip);
  const setSource = useStore((s) => s.setSource);

  const [clipLoading, setClipLoading] = useState(false);
  const [loadedClipId, setLoadedClipId] = useState<string | null>(null);

  // After video is ready: capture thumbnail + real duration and update IndexedDB
  useEffect(() => {
    if (!loadedClipId || !userId) return;
    const v = videoRef.current;
    if (!v) return;
    const capture = async () => {
      const thumb = captureVideoThumbnail(v);
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const { updateSourceClipMeta } = await import("@/lib/clip-db");
      updateSourceClipMeta(loadedClipId, thumb, dur, userId).catch(console.warn);
    };
    if (v.readyState >= 2 && v.videoWidth > 0) capture();
    else v.addEventListener("loadeddata", capture, { once: true });
  }, [loadedClipId, userId]);

  const loadClip = async (id: string, authHeaders: Record<string, string>, ownerId: string) => {
    console.log("[loadClip] id:", id, "hasAuth:", !!authHeaders.Authorization);
    const r2Res = await fetch(`/api/clip-url?id=${id}`, { headers: authHeaders });
    console.log("[loadClip] clip-url status:", r2Res.status);
    if (r2Res.ok) {
      const blob = await r2Res.blob();
      if (currentUserRef.current !== ownerId) return;
      const objectUrl = URL.createObjectURL(blob);
      const file = new File([blob], "extension-clip.webm", { type: blob.type || "video/webm" });
      setSource(file, objectUrl, "Extension clip");
      window.history.replaceState({}, "", "/");
      console.log("[loadClip] SUCCESS — clip loaded from R2");

      // Save to IndexedDB (thumbnail filled in by the useEffect above once video loads)
      const { saveSourceClip } = await import("@/lib/clip-db");
      saveSourceClip({ id, userId: ownerId, blob, title: "Extension clip", thumbnail: "", duration: 0, savedAt: Date.now() })
        .catch(console.warn);

      // Delete from R2 — no longer needed; clip lives in browser storage
      fetch(`/api/clip-url?id=${id}`, { method: "DELETE", headers: authHeaders }).catch(console.warn);

      setLoadedClipId(id);
      return;
    }
    console.warn("[loadClip] clip-url failed, falling back to in-memory");
    // Fallback: in-memory store (local dev without R2)
    const memRes = await fetch(`/api/receive-clip?id=${id}`, { headers: authHeaders });
    console.log("[loadClip] receive-clip status:", memRes.status);
    if (!memRes.ok) throw new Error(`Clip not found or expired (${memRes.status})`);
    const blob = await memRes.blob();
    if (currentUserRef.current !== ownerId) return;
    const objectUrl = URL.createObjectURL(blob);
    const file = new File([blob], "extension-clip.mp4", { type: blob.type || "video/mp4" });
    setSource(file, objectUrl, "Extension clip");
    window.history.replaceState({}, "", "/");
    console.log("[loadClip] SUCCESS — clip loaded from in-memory store");
  };

  // Load audio buffer for waveform when file changes
  useEffect(() => {
    if (!sourceFile) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const buf = await audioCtxRef.current.decodeAudioData(ev.target!.result as ArrayBuffer);
        setAudioBuffer(buf);
      } catch (err) {
        console.warn("Audio decode failed", err);
      }
    };
    reader.readAsArrayBuffer(sourceFile);
  }, [sourceFile]);

  // Auto-transcribe on podcast mode file upload
  useEffect(() => {
    if (mode !== "podcast" || !sourceFile) return;
    transcribeFile(sourceFile);
  }, [mode, sourceFile]);

  // Auto-detect scene cuts on reality mode
  useEffect(() => {
    if (mode !== "reality" || !sourceObjectURL) return;
    const v = videoRef.current;
    if (!v) return;
    setDetectingScenes(true);
    detectSceneCuts(v, (pct) => {
      // progress optional
    }).then((cuts) => {
      setSceneCuts(cuts);
      setDetectingScenes(false);
    }).catch(() => setDetectingScenes(false));
  }, [mode, sourceObjectURL]);

  const transcribeFile = async (file: File) => {
    setTranscribing(true);
    setActiveTool("transcript");
    try {
      const { extractAudio } = await import("@/lib/ffmpeg-client");
      const audio = await extractAudio(file);
      if (audio.size > 4 * 1024 * 1024) throw new Error("Audio exceeds the hosted transcription limit of 4 MB; use a shorter clip");
      const formData = new FormData();
      formData.append("audio", audio, "audio.mp3");
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) throw new Error("Sign in to transcribe audio");
      const res = await fetch("/api/transcribe", { method: "POST", body: formData, headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 503 && data.message) {
          console.warn("Transcription skipped:", data.message);
          return;
        }
        throw new Error(`Transcription API error ${res.status}: ${data.error || res.statusText}`);
      }
      const data = await res.json();
      if (data.segments) {
        setTranscript(data.segments);
        setSuggestions(generateSuggestions(data.segments));
      }
    } catch (err) {
      console.error("Transcription failed:", err);
    } finally {
      setTranscribing(false);
    }
  };

  const handleCapture = (stream: MediaStream) => {
    setCaptureStream(stream);
    stream.getVideoTracks()[0].onended = () => {
      setCaptureStream(null);
      useStore.getState().setCapture({ active: false });
    };
  };

  // Function declaration — hoisted, no TDZ possible regardless of webpack ordering
  async function handleExport() {
    if (workspaceTab !== "editor") return;
    const v = videoRef.current;
    const { clip, overlays, aspectRatio, muteAudio, mode, sourceFile, fillMode, cropZoom, playbackRate } = useStore.getState();

    if (!v || v.readyState < 2 || useStore.getState().exporting || clip.outPoint <= clip.inPoint) return;
    if (!isFinite(clip.outPoint)) {
      alert("Use 'Grab last Ns' in the capture bar to save a clip first, then export.");
      return;
    }

    setExporting(true);
    setExportProgress(0);

    try {
      const duration = clip.outPoint - clip.inPoint;

      const OUTPUT_DIMS: Record<string, { w: number; h: number }> = {
        "9:16": { w: 1080, h: 1920 },
        "1:1": { w: 1080, h: 1080 },
        "16:9": { w: 1920, h: 1080 },
      };
      const { w: outW, h: outH } = OUTPUT_DIMS[aspectRatio] || { w: 1920, h: 1080 };

      const offCanvas = document.createElement("canvas");
      offCanvas.width = outW;
      offCanvas.height = outH;
      const offCtx = offCanvas.getContext("2d")!;

      // --- Video recorder: canvas only (no audio mixing) ---
      const videoMime = ["video/webm;codecs=vp9", "video/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t)
      ) || "video/webm";
      const videoRecorder = new MediaRecorder(offCanvas.captureStream(30), { mimeType: videoMime });
      const videoChunks: Blob[] = [];
      videoRecorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunks.push(e.data); };

      // --- Separate audio recorder: v.captureStream() audio tracks only ---
      let audioRecorder: MediaRecorder | null = null;
      const audioChunks: Blob[] = [];
      if (!muteAudio) {
        try {
          const vStream: MediaStream | undefined = (v as any).captureStream?.();
          const aTracks = vStream?.getAudioTracks() ?? [];
          if (aTracks.length > 0) {
            const audioOnlyStream = new MediaStream(aTracks);
            const audioMime = ["audio/webm;codecs=opus", "audio/webm"].find((t) =>
              MediaRecorder.isTypeSupported(t)
            ) || "audio/webm";
            audioRecorder = new MediaRecorder(audioOnlyStream, { mimeType: audioMime });
            audioRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
          }
        } catch { /* audio capture unavailable */ }
      }

      // Seek to inPoint
      v.pause();
      v.currentTime = clip.inPoint;
      await new Promise<void>((res) => {
        const fn = () => { v.removeEventListener("seeked", fn); res(); };
        v.addEventListener("seeked", fn);
      });

      const fScale = outW / 140;
      const FONT_MAP_EXPORT: Record<string, string> = {
        CAPTION: `bold ${Math.round(18 * fScale)}px Arial, sans-serif`,
        IMPACT: `900 ${Math.round(24 * fScale)}px Impact, Arial Narrow, sans-serif`,
        QUOTE: `italic ${Math.round(20 * fScale)}px Georgia, serif`,
        SUBTITLE: `600 ${Math.round(14 * fScale)}px Arial, sans-serif`,
        HEADLINE: `800 ${Math.round(22 * fScale)}px Arial, sans-serif`,
      };

      let rafId = 0;
      const drawFrame = () => {
        offCtx.fillStyle = "#000";
        offCtx.fillRect(0, 0, outW, outH);

        if (v.readyState >= 2 && v.videoWidth > 0) {
          const vw = v.videoWidth, vh = v.videoHeight;
          const srcA = vw / vh, dstA = outW / outH;

          if (aspectRatio === "9:16") {
            const scMin = Math.min(outW / vw, outH / vh);
            const scMax = Math.max(outW / vw, outH / vh);
            if (fillMode === "crop") {
              const sc = scMin + (scMax - scMin) * cropZoom;
              if (cropZoom < 1) {
                offCtx.save();
                offCtx.filter = "blur(40px) brightness(0.65)";
                offCtx.drawImage(v, (outW - vw * scMax) / 2, (outH - vh * scMax) / 2, vw * scMax, vh * scMax);
                offCtx.restore();
                offCtx.filter = "none";
              }
              offCtx.drawImage(v, (outW - vw * sc) / 2, (outH - vh * sc) / 2, vw * sc, vh * sc);
            } else {
              offCtx.save();
              offCtx.filter = "blur(40px) brightness(0.65)";
              offCtx.drawImage(v, (outW - vw * scMax) / 2, (outH - vh * scMax) / 2, vw * scMax, vh * scMax);
              offCtx.restore();
              offCtx.filter = "none";
              offCtx.drawImage(v, 0, (outH - outW / srcA) / 2, outW, outW / srcA);
            }
          } else if (aspectRatio === "1:1") {
            if (srcA > dstA) {
              offCtx.drawImage(v, (vw - vh * dstA) / 2, 0, vh * dstA, vh, 0, 0, outW, outH);
            } else {
              offCtx.drawImage(v, 0, (vh - vw / dstA) / 2, vw, vw / dstA, 0, 0, outW, outH);
            }
          } else {
            offCtx.drawImage(v, 0, 0, outW, outH);
          }
        }

        overlays.forEach((o) => {
          if (o.startTime !== undefined &&
              (v.currentTime < o.startTime || v.currentTime > (o.endTime ?? Infinity))) return;
          const ox = o.x * outW, oy = o.y * outH, ow = o.width * outW, oh = o.height * outH;

          if (o.type === "blur" && v.readyState >= 2) {
            const rx = ox - ow / 2, ry = oy - oh / 2;
            offCtx.save();
            offCtx.globalAlpha = o.opacity ?? 0.85;
            offCtx.filter = "blur(8px)";
            offCtx.drawImage(v, rx, ry, ow, oh, rx, ry, ow, oh);
            offCtx.restore();
            offCtx.filter = "none";
            return;
          }

          offCtx.save();
          offCtx.translate(ox, oy);
          offCtx.rotate((o.rotation * Math.PI) / 180);
          if (o.type === "emoji" && o.emoji) {
            offCtx.font = `${o.width * outW}px serif`;
            offCtx.textAlign = "center";
            offCtx.textBaseline = "middle";
            offCtx.fillText(o.emoji, 0, 0);
          }
          if (o.type === "text" && o.text) {
            const preset = o.preset || "CAPTION";
            offCtx.font = FONT_MAP_EXPORT[preset] || FONT_MAP_EXPORT.CAPTION;
            offCtx.textAlign = "center";
            offCtx.textBaseline = "middle";
            if (preset === "IMPACT") { offCtx.strokeStyle = "#000"; offCtx.lineWidth = 8 * fScale; offCtx.strokeText(o.text, 0, 0, ow); }
            if (preset === "SUBTITLE") {
              const m = offCtx.measureText(o.text);
              const px = 12 * fScale, py = 6 * fScale;
              offCtx.fillStyle = "rgba(0,0,0,0.6)";
              offCtx.beginPath();
              offCtx.roundRect(-m.width / 2 - px, -10 * fScale - py, m.width + px * 2, 20 * fScale + py * 2, 6 * fScale);
              offCtx.fill();
            }
            offCtx.fillStyle = o.color || "#ffffff";
            offCtx.fillText(o.text, 0, 0, ow);
          }
          offCtx.restore();
        });

        const elapsed = v.currentTime - clip.inPoint;
        setExportProgress(Math.min(94, Math.round((elapsed / duration) * 94)));

        if (v.currentTime < clip.outPoint && !v.paused && !v.ended) {
          rafId = requestAnimationFrame(drawFrame);
        }
      };

      // Start both recorders before playing
      v.playbackRate = playbackRate;
      videoRecorder.start(100);
      audioRecorder?.start(100);
      await v.play();
      rafId = requestAnimationFrame(drawFrame);

      await new Promise<void>((resolve) => {
        const poll = setInterval(() => {
          if (v.currentTime >= clip.outPoint || v.ended || v.paused) {
            clearInterval(poll);
            v.pause();
            cancelAnimationFrame(rafId);
            videoRecorder.stop();
            audioRecorder?.stop();
            resolve();
          }
        }, 50);
      });

      // Wait for both recorders to flush
      await Promise.all([
        new Promise<void>((r) => { videoRecorder.onstop = () => r(); }),
        audioRecorder
          ? new Promise<void>((r) => { audioRecorder!.onstop = () => r(); })
          : Promise.resolve(),
      ]);

      setExportProgress(96);

      const videoBlob = new Blob(videoChunks, { type: videoMime });
      const audioBlob = audioChunks.length > 0 ? new Blob(audioChunks, { type: "audio/webm" }) : null;
      const ts = Date.now();

      let exportUrl: string;
      let exportFileName: string;

      let exportBlob: Blob;
      try {
        const { remuxToMp4 } = await import("@/lib/ffmpeg-client");
        exportBlob = audioBlob
          ? await mergeAudioVideo(videoBlob, audioBlob)
          : await remuxToMp4(videoBlob);
        exportFileName = `clipmemeeditor-${ts}.mp4`;
      } catch (mergeErr) {
        console.warn("Client merge failed, exporting WebM:", mergeErr);
        exportBlob = videoBlob;
        exportFileName = `clipmemeeditor-${ts}.webm`;
      }

      exportUrl = URL.createObjectURL(exportBlob);
      const thumb = captureVideoThumbnail(v);
      const item: ClipHistoryItem = {
        id: generateId(),
        mode,
        thumbnail: thumb,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        duration,
        overlays,
        aspectRatio,
        exportedAt: Date.now(),
        fileName: sourceFile?.name,
        exportUrl,
        exportFileName,
      };
      try {
        const { data: { session } } = await createClient().auth.getSession();
        if (!session) throw new Error("Sign in to save clips");
        const { saveExport } = await import("@/lib/export-history");
        await saveExport(session.user.id, item, exportBlob);
      } catch (error) { URL.revokeObjectURL(exportUrl); throw error; }
      addToHistory(item);
      setExportProgress(100);
      return item;
    } catch (err: any) {
      console.error("Export failed:", err);
      alert(`Save to History failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  // Export all queued segments — renders each to canvas, stitches via /api/stitch, remuxes to MP4
  async function handleExportQueued() {
    if (workspaceTab !== "editor") return;
    const v = videoRef.current;
    const { queuedSegments, aspectRatio, muteAudio, mode, sourceFile, fillMode, playbackRate } =
      useStore.getState();
    if (!v || useStore.getState().exporting || queuedSegments.length === 0) return;

    setExporting(true);
    setExportProgress(0);

    try {
      const OUTPUT_DIMS: Record<string, { w: number; h: number }> = {
        "9:16": { w: 1080, h: 1920 },
        "1:1": { w: 1080, h: 1080 },
        "16:9": { w: 1920, h: 1080 },
      };
      const { w: outW, h: outH } = OUTPUT_DIMS[aspectRatio] || { w: 1920, h: 1080 };

      const offCanvas = document.createElement("canvas");
      offCanvas.width = outW;
      offCanvas.height = outH;
      const offCtx = offCanvas.getContext("2d")!;

      // Pre-detect audio tracks from captureStream (do this once before the loop)
      let captureAudioTracks: MediaStreamTrack[] = [];
      if (!muteAudio) {
        try {
          const vStream: MediaStream | undefined = (v as any).captureStream?.();
          captureAudioTracks = vStream?.getAudioTracks() ?? [];
        } catch { /* no audio */ }
      }

      const videoMime = ["video/webm;codecs=vp9", "video/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t)
      ) || "video/webm";
      const audioMime = ["audio/webm;codecs=opus", "audio/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t)
      ) || "audio/webm";

      const fScale = outW / 140;
      const FONT_MAP: Record<string, string> = {
        CAPTION: `bold ${Math.round(18 * fScale)}px Arial, sans-serif`,
        IMPACT: `900 ${Math.round(24 * fScale)}px Impact, Arial Narrow, sans-serif`,
        QUOTE: `italic ${Math.round(20 * fScale)}px Georgia, serif`,
        SUBTITLE: `600 ${Math.round(14 * fScale)}px Arial, sans-serif`,
        HEADLINE: `800 ${Math.round(22 * fScale)}px Arial, sans-serif`,
      };

      // Each segment produces { videoBlob, audioBlob | null }
      const segmentPairs: Array<{ video: Blob; audio: Blob | null }> = [];

      for (let si = 0; si < queuedSegments.length; si++) {
        const seg = queuedSegments[si];
        const segDuration = seg.outPoint - seg.inPoint;

        // Video-only canvas recorder
        const videoRecorder = new MediaRecorder(offCanvas.captureStream(30), { mimeType: videoMime });
        const chunks: Blob[] = [];
        videoRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        // Independent audio recorder
        let audioRecorder: MediaRecorder | null = null;
        const audioChunks: Blob[] = [];
        if (captureAudioTracks.length > 0) {
          try {
            audioRecorder = new MediaRecorder(new MediaStream(captureAudioTracks), { mimeType: audioMime });
            audioRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
          } catch { /* skip audio for this segment */ }
        }

        v.pause();
        v.currentTime = seg.inPoint;
        await new Promise<void>((res) => {
          const fn = () => { v.removeEventListener("seeked", fn); res(); };
          v.addEventListener("seeked", fn);
        });

        let rafId = 0;
        const drawFrame = () => {
          offCtx.fillStyle = "#000";
          offCtx.fillRect(0, 0, outW, outH);
          if (v.readyState >= 2 && v.videoWidth > 0) {
            const vw = v.videoWidth, vh = v.videoHeight;
            const srcA = vw / vh, dstA = outW / outH;
            if (aspectRatio === "9:16") {
              const sc = Math.max(outW / vw, outH / vh);
              if (fillMode === "crop") {
                offCtx.drawImage(v, (outW - vw * sc) / 2, (outH - vh * sc) / 2, vw * sc, vh * sc);
              } else {
                offCtx.save();
                offCtx.filter = "blur(40px) brightness(0.65)";
                offCtx.drawImage(v, (outW - vw * sc) / 2, (outH - vh * sc) / 2, vw * sc, vh * sc);
                offCtx.restore();
                offCtx.filter = "none";
                offCtx.drawImage(v, 0, (outH - outW / srcA) / 2, outW, outW / srcA);
              }
            } else if (aspectRatio === "1:1") {
              if (srcA > dstA) {
                const sw = vh * dstA;
                offCtx.drawImage(v, (vw - sw) / 2, 0, sw, vh, 0, 0, outW, outH);
              } else {
                const sh = vw / dstA;
                offCtx.drawImage(v, 0, (vh - sh) / 2, vw, sh, 0, 0, outW, outH);
              }
            } else {
              offCtx.drawImage(v, 0, 0, outW, outH);
            }
          }
          // Use this segment's own snapshotted overlays (not the global store)
          seg.overlays.forEach((o) => {
            const ox = o.x * outW, oy = o.y * outH, ow = o.width * outW, oh = o.height * outH;

            if (o.type === "blur" && v.readyState >= 2) {
              const rx = ox - ow / 2, ry = oy - oh / 2;
              offCtx.save();
              offCtx.globalAlpha = o.opacity ?? 0.85;
              offCtx.filter = "blur(8px)";
              offCtx.drawImage(v, rx, ry, ow, oh, rx, ry, ow, oh);
              offCtx.restore();
              offCtx.filter = "none";
              return;
            }

            offCtx.save();
            offCtx.translate(ox, oy);
            offCtx.rotate((o.rotation * Math.PI) / 180);
            if (o.type === "emoji" && o.emoji) {
              offCtx.font = `${o.width * outW}px serif`;
              offCtx.textAlign = "center";
              offCtx.textBaseline = "middle";
              offCtx.fillText(o.emoji, 0, 0);
            }
            if (o.type === "text" && o.text) {
              const preset = o.preset || "CAPTION";
              offCtx.font = FONT_MAP[preset] || FONT_MAP.CAPTION;
              offCtx.textAlign = "center";
              offCtx.textBaseline = "middle";
              if (preset === "IMPACT") { offCtx.strokeStyle = "#000"; offCtx.lineWidth = 8 * fScale; offCtx.strokeText(o.text, 0, 0, ow); }
              if (preset === "SUBTITLE") {
                const m = offCtx.measureText(o.text);
                const px = 12 * fScale, py = 6 * fScale;
                offCtx.fillStyle = "rgba(0,0,0,0.6)";
                offCtx.beginPath();
                offCtx.roundRect(-m.width / 2 - px, -10 * fScale - py, m.width + px * 2, 20 * fScale + py * 2, 6 * fScale);
                offCtx.fill();
              }
              offCtx.fillStyle = o.color || "#ffffff";
              offCtx.fillText(o.text, 0, 0, ow);
            }
            offCtx.restore();
          });
          const elapsed = v.currentTime - seg.inPoint;
          const segPct = (si / queuedSegments.length + elapsed / segDuration / queuedSegments.length) * 95;
          setExportProgress(Math.min(94, Math.round(segPct)));
          if (v.currentTime < seg.outPoint && !v.paused && !v.ended) {
            rafId = requestAnimationFrame(drawFrame);
          }
        };

        v.playbackRate = playbackRate;
        videoRecorder.start(100);
        audioRecorder?.start(100);
        await v.play();
        rafId = requestAnimationFrame(drawFrame);

        await new Promise<void>((resolve) => {
          const poll = setInterval(() => {
            if (v.currentTime >= seg.outPoint || v.ended || v.paused) {
              clearInterval(poll);
              v.pause();
              cancelAnimationFrame(rafId);
              videoRecorder.stop();
              audioRecorder?.stop();
              resolve();
            }
          }, 50);
        });

        await Promise.all([
          new Promise<void>((r) => { videoRecorder.onstop = () => r(); }),
          audioRecorder ? new Promise<void>((r) => { audioRecorder!.onstop = () => r(); }) : Promise.resolve(),
        ]);

        segmentPairs.push({
          video: new Blob(chunks, { type: videoMime }),
          audio: audioChunks.length > 0 ? new Blob(audioChunks, { type: audioMime }) : null,
        });
      }

      setExportProgress(95);
      const ts = Date.now();
      let exportUrl: string;
      let exportFileName: string;

      // Merge audio into each segment's video client-side, then stitch
      const { remuxToMp4: remux } = await import("@/lib/ffmpeg-client");
      const mergedBlobs: Blob[] = [];
      for (const pair of segmentPairs) {
        try {
          const merged = pair.audio
            ? await mergeAudioVideo(pair.video, pair.audio)
            : await remux(pair.video);
          mergedBlobs.push(merged);
        } catch {
          mergedBlobs.push(pair.video);
        }
      }

      let exportBlob: Blob;
      if (mergedBlobs.length === 1) {
        exportBlob = mergedBlobs[0];
        exportFileName = `clipmemeeditor-${ts}.mp4`;
      } else {
        exportBlob = await stitchBlobs(mergedBlobs);
        exportFileName = `clipmemeeditor-stitched-${ts}.mp4`;
      }

      exportUrl = URL.createObjectURL(exportBlob);
      const item: ClipHistoryItem = {
        id: generateId(), mode, thumbnail: captureVideoThumbnail(v),
        inPoint: 0, outPoint: queuedSegments.reduce((total, segment) => total + segment.outPoint - segment.inPoint, 0),
        duration: queuedSegments.reduce((total, segment) => total + segment.outPoint - segment.inPoint, 0),
        overlays: [], aspectRatio, exportedAt: Date.now(), fileName: sourceFile?.name,
        exportUrl, exportFileName,
      };
      try {
        const { data: { session } } = await createClient().auth.getSession();
        if (!session) throw new Error("Sign in to save clips");
        const { saveExport } = await import("@/lib/export-history");
        await saveExport(session.user.id, item, exportBlob);
      } catch (error) { URL.revokeObjectURL(exportUrl); throw error; }
      addToHistory(item);

      useStore.getState().clearQueuedSegments();
      setExportProgress(100);
    } catch (err: any) {
      console.error("Queued export failed:", err);
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isEditorShortcutAllowed(e, workspaceTab === "editor", useStore.getState().exporting)) return;
      const v = videoRef.current;
      if (!v) return;

      const { playing, currentTime, sourceDuration } = useStore.getState();

      switch (e.key) {
        case " ":
          e.preventDefault();
          setPlaying(!playing);
          if (playing) v.pause(); else v.play().catch(() => {});
          break;
        case "[":
          setClip({ inPoint: Math.max(0, currentTime) });
          break;
        case "]":
          setClip({ outPoint: Math.min(sourceDuration, currentTime) });
          break;
        case "ArrowLeft":
          v.currentTime = Math.max(0, v.currentTime - 5);
          break;
        case "ArrowRight":
          v.currentTime = Math.min(v.duration, v.currentTime + 5);
          break;
        case "c":
        case "C": {
          const { sourceDuration: dur } = useStore.getState();
          if (!isFinite(dur)) {
            // Live capture — grab last 10s via event
            window.dispatchEvent(new CustomEvent("clipmeme:grab-last", { detail: { seconds: 10 } }));
          } else {
            handleExport();
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [workspaceTab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Head>
        <title>ClipMemeEditor — Clip · Caption · Meme</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="flex flex-col h-screen overflow-hidden bg-[#0f0f0f]" style={{ minWidth: workspaceTab === "editor" ? 1024 : 0 }}>
        {/* ── Top bar ── */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-[#1a1a1a] shrink-0">
          <div className="text-base font-black text-white tracking-tight">
            Clip<span className="text-[#ff4444]">MemeEditor</span>
          </div>
          <div className="flex gap-2 ml-4" role="tablist" aria-label="Workspace">
            {(["editor", "schedule"] as const).map(tab => <button key={tab} role="tab" disabled={exporting} aria-selected={workspaceTab === tab} onClick={() => {
              videoRef.current?.pause();setPlaying(false);setWorkspaceTab(tab);
            }} className={`px-3 py-1.5 text-xs rounded border disabled:opacity-40 ${workspaceTab === tab ? "border-[#ff4444] text-white" : "border-[#333] text-[#999]"}`}>{tab === "editor" ? "Editor" : "Schedule"}</button>)}
          </div>
          <div className="flex-1" />
          {userId && (
            <UserProfile key={userId} userId={userId} email={userEmail ?? ""}
                onSignOut={async () => {
                  const { error } = await createClient().auth.signOut();
                  if (error) { alert("Could not sign out. Please try again."); return; }
                  router.replace("/login");
                }}
            />
          )}
        </div>

        {/* ── Main layout: left (video+timeline) + right (tools+preview) ── */}
        {workspaceTab === "schedule" && <ScheduleCalendar />}
        <div inert={workspaceTab !== "editor"} aria-hidden={workspaceTab !== "editor"} className={`${workspaceTab === "editor" ? "flex" : "hidden"} flex-1 overflow-hidden`}>
          {/* LEFT — video stage + timeline */}
          <div className="flex flex-col gap-2 p-3 flex-1 overflow-hidden">
            <div className="flex-1 min-h-0 relative">
              <VideoStage
                active={workspaceTab === "editor"}
                captureStream={captureStream}
                onCapture={handleCapture}
                videoRef={videoRef}
              />
              {clipLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 rounded-xl z-50 gap-3">
                  <div className="text-3xl animate-spin">⟳</div>
                  <p className="text-sm text-white">Loading clip…</p>
                </div>
              )}
            </div>

            {/* Capture recorder bar */}
            <CaptureRecorder captureStream={captureStream} />

            {/* Scene detecting status */}
            {detectingScenes && (
              <div className="text-[10px] text-[#ffca28] px-1 animate-pulse">
                ⟳ Detecting scene cuts…
              </div>
            )}

            {/* Waveform */}
            <WaveformStrip audioBuffer={audioBuffer} />

            {/* Quick clip bar */}
            <QuickClipBar />
          </div>

          {/* RIGHT — tool panel + preview + export */}
          <div className="flex w-80 shrink-0 border-l border-[#1a1a1a] flex-col overflow-hidden">
            {/* Tool tabs */}
            <div className="flex border-b border-[#1a1a1a] shrink-0 overflow-x-auto">
              {TOOL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTool(tab.id)}
                  className={`px-3 py-2 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                    activeTool === tab.id
                      ? "border-[#ff4444] text-white"
                      : "border-transparent text-[#555] hover:text-[#888]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Scrollable tool content + export settings */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {activeTool === "cut" && <CutTool />}
              {activeTool === "text" && <TextTool />}
              {activeTool === "memes" && <MemesTool />}
              {activeTool === "transcript" && <TranscriptPanel />}
              {activeTool === "history" && <HistoryPanel key={userId} userId={userId} />}
              <ExportPanel videoRef={videoRef} onExport={handleExport} onExportQueued={handleExportQueued} />
            </div>

            {/* Preview canvas — always pinned at bottom */}
            <div className="shrink-0 border-t border-[#1a1a1a] px-3 py-2">
              <p className="text-[10px] text-[#555] font-bold uppercase tracking-wider mb-2">Preview</p>
              <div className="flex justify-center bg-[#111] rounded-xl p-2">
                <PreviewCanvas active={workspaceTab === "editor"} videoRef={videoRef} width={140} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function captureVideoThumbnail(video: HTMLVideoElement): string {
  try {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 68;
    c.getContext("2d")?.drawImage(video, 0, 0, 120, 68);
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return "";
  }
}

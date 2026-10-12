import { useRef, useEffect, useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/utils";
import DrawSelection from "./DrawSelection";
import CaptureModal from "./CaptureModal";

interface Props {
  captureStream: MediaStream | null;
  onCapture: (stream: MediaStream) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export default function VideoStage({ captureStream, onCapture, videoRef: externalRef }: Props) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef || internalRef;
  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [showDrawSelection, setShowDrawSelection] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  const sourceObjectURL = useStore((s) => s.sourceObjectURL);
  const capture = useStore((s) => s.capture);
  const setCapture = useStore((s) => s.setCapture);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const currentTime = useStore((s) => s.currentTime);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const playbackRate = useStore((s) => s.playbackRate);
  const setPlaybackRate = useStore((s) => s.setPlaybackRate);
  const setDuration = useStore((s) => s.setDuration);
  const sourceDuration = useStore((s) => s.sourceDuration);
  const clip = useStore((s) => s.clip);
  const setClip = useStore((s) => s.setClip);

  // Wire file source
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !sourceObjectURL) return;
    // srcObject takes priority over src in browsers — must clear it first
    v.srcObject = null;
    v.src = sourceObjectURL;
    v.load();
  }, [sourceObjectURL]);

  // Wire capture stream
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (captureStream) {
      v.srcObject = captureStream;
      v.play().catch(() => {});
    } else {
      // Stream ended — clear srcObject so a blob src (if any) can play
      v.srcObject = null;
    }
  }, [captureStream]);

  // Sync play/pause
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !sourceObjectURL) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, sourceObjectURL]);

  // Sync rate
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = playbackRate;
  }, [playbackRate]);

  // Sync volume
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = isMuted;
  }, [volume, isMuted]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
  }, [setCurrentTime]);

  const detectingDurationRef = useRef(false);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isFinite(v.duration) && v.duration > 0) {
      setDuration(v.duration);
      setClip({ inPoint: 0, outPoint: v.duration });
    } else {
      // MediaRecorder WebM files have duration=Infinity. Seeking to a huge time
      // forces the browser to scan the file and populate seekable.end().
      detectingDurationRef.current = true;
      v.currentTime = 1e9;
    }
  }, [setDuration, setClip]);

  const handleSeeked = useCallback(() => {
    const v = videoRef.current;
    // Only act during the initial duration-detection seek — not on normal user seeks.
    if (!v || !detectingDurationRef.current) return;
    detectingDurationRef.current = false;
    if (v.seekable.length > 0) {
      const dur = v.seekable.end(v.seekable.length - 1);
      if (isFinite(dur) && dur > 0) {
        v.currentTime = 0;
        setDuration(dur);
        setClip({ inPoint: 0, outPoint: dur });
      }
    }
  }, [setDuration, setClip]);

  const handleScrubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || sourceDuration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * sourceDuration;
  }, [sourceDuration]);

  const togglePlay = useCallback(() => setPlaying(!playing), [playing, setPlaying]);


  const handleGetDisplayMedia = async () => {
    setShowCaptureModal(false);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" } as MediaTrackConstraints,
        audio: true,
      });
      const hasAudio = stream.getAudioTracks().length > 0;
      setCapture({ active: true, method: "displayMedia", hasAudio, cropRect: null });
      if (!hasAudio) {
        alert("⚠️ No audio captured. Please disconnect, then try again and check 'Also share tab audio' in the browser dialog.");
      }
      onCapture(stream);
    } catch (err) {
      console.error("getDisplayMedia failed:", err);
    }
  };

  const hasSource = !!(sourceObjectURL || captureStream);
  const progress = sourceDuration > 0 ? (currentTime / sourceDuration) * 100 : 0;

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setSource = useStore((s) => s.setSource);
  const clearSource = useStore((s) => s.clearSource);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) { clearSource(); setSource(file, URL.createObjectURL(file)); }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { clearSource(); setSource(file, URL.createObjectURL(file)); }
    e.target.value = "";
  };

  return (
    <div
      className={`relative w-full h-full bg-black rounded-xl overflow-hidden border transition-colors ${isDragging ? "border-[#ff4444]" : "border-[#1e1e1e]"}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onSeeked={handleSeeked}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        playsInline
      />

      {/* Empty state */}
      {!hasSource && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-4 transition-colors ${isDragging ? "bg-[#ff4444]/5" : ""}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileInput}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center gap-4 border-2 border-dashed rounded-2xl px-16 py-12 transition-colors cursor-pointer ${isDragging ? "border-[#ff4444] text-[#ff4444]" : "border-[#2a2a2a] text-[#555] hover:border-[#444] hover:text-[#888]"}`}
          >
            <div className="text-5xl">{isDragging ? "📂" : "🎬"}</div>
            <p className="text-sm text-center">
              {isDragging ? "Drop to load" : "Drop or click to open video"}
            </p>
            {!isDragging && (
              <p className="text-[11px] text-[#444] text-center">
                or use the browser extension to clip from any site
              </p>
            )}
          </div>
        </div>
      )}

      {/* Status badges */}
      {hasSource && (
        <div className="absolute top-3 left-3 flex items-center gap-2">
          {capture.active && (
            <span className="flex items-center gap-1.5 px-2 py-1 bg-black/70 border border-[#4caf50] rounded text-[10px] font-bold text-[#4caf50]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4caf50] animate-pulse" />
              CAPTURING
            </span>
          )}
          {capture.active && !capture.hasAudio && (
            <span className="px-2 py-1 bg-black/70 border border-[#ff9800] rounded text-[10px] font-bold text-[#ff9800]">
              ⚠️ NO AUDIO
            </span>
          )}
        </div>
      )}

      {/* Controls overlay (bottom) */}
      {sourceObjectURL && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8">
          {/* Progress bar */}
          <div
            className="w-full h-1 bg-white/20 rounded-full mb-2 cursor-pointer relative"
            onClick={handleScrubClick}
          >
            <div
              className="h-full bg-[#ff4444] rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full -translate-x-1/2 cursor-grab"
              style={{ left: `${progress}%` }}
            />
          </div>

          {/* Buttons row */}
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} className="text-white text-lg leading-none">
              {playing ? "⏸" : "▶"}
            </button>
            <span className="text-[11px] text-[#aaa] tabular-nums">
              {formatTime(currentTime)} / {formatTime(sourceDuration)}
            </span>
            <div className="ml-auto relative">
              <button
                onClick={() => setShowSpeedMenu((v) => !v)}
                className="px-2 py-0.5 bg-white/10 rounded text-[10px] text-[#ccc] font-semibold"
              >
                {playbackRate}×
              </button>
              {showSpeedMenu && (
                <div
                  className="absolute bottom-full mb-1 right-0 bg-[#1e1e1e] border border-[#333] rounded-lg overflow-hidden shadow-xl z-50"
                  onMouseLeave={() => setShowSpeedMenu(false)}
                >
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setPlaybackRate(s); setShowSpeedMenu(false); }}
                      className={`block w-full text-left px-4 py-1.5 text-[12px] font-semibold hover:bg-white/10 transition-colors ${
                        s === playbackRate ? "text-[#ff4444]" : "text-[#ccc]"
                      }`}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="text-[#ccc] text-sm"
            >
              {isMuted ? "🔇" : "🔊"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-16 h-1 accent-[#ff4444]"
            />
            <span className="text-[10px] text-[#555]">
              Space · [ ] trim
            </span>
          </div>
        </div>
      )}

      {/* Draw selection overlay */}
      {showDrawSelection && (
        <DrawSelection
          onSelect={(rect) => {
            setCapture({ cropRect: rect });
            setShowDrawSelection(false);
          }}
          onSkip={() => setShowDrawSelection(false)}
        />
      )}

      {/* Capture method modal */}
      {showCaptureModal && (
        <CaptureModal
          onGetDisplayMedia={handleGetDisplayMedia}
          onClose={() => setShowCaptureModal(false)}
        />
      )}
    </div>
  );
}

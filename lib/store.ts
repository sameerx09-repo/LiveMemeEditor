import { create } from "zustand";
import type {
  Mode, AspectRatio, Overlay, ClipSelection,
  TranscriptSegment, ClipSuggestion, CaptureState,
  ClipHistoryItem, SceneCut,
} from "./types";

interface AppState {
  mode: Mode;
  setMode: (m: Mode) => void;

  sourceFile: File | null;
  sourceObjectURL: string | null;
  sourceTitle: string | null;
  sourceDuration: number;
  setSource: (file: File | null, url: string, title?: string) => void;
  clearSource: () => void;
  setDuration: (d: number) => void;

  capture: CaptureState;
  setCapture: (c: Partial<CaptureState>) => void;

  currentTime: number;
  playing: boolean;
  playbackRate: number;
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setPlaybackRate: (r: number) => void;

  clip: ClipSelection;
  setClip: (c: Partial<ClipSelection>) => void;

  overlays: Overlay[];
  selectedOverlayId: string | null;
  addOverlay: (o: Overlay) => void;
  updateOverlay: (id: string, changes: Partial<Overlay>) => void;
  removeOverlay: (id: string) => void;
  selectOverlay: (id: string | null) => void;

  aspectRatio: AspectRatio;
  setAspectRatio: (a: AspectRatio) => void;

  transcript: TranscriptSegment[];
  transcribing: boolean;
  setTranscript: (t: TranscriptSegment[]) => void;
  setTranscribing: (b: boolean) => void;

  suggestions: ClipSuggestion[];
  setSuggestions: (s: ClipSuggestion[]) => void;

  sceneCuts: SceneCut[];
  setSceneCuts: (cuts: SceneCut[]) => void;

  muteAudio: boolean;
  setMuteAudio: (b: boolean) => void;

  fillMode: "letterbox" | "crop";
  setFillMode: (m: "letterbox" | "crop") => void;

  cropZoom: number;
  setCropZoom: (z: number) => void;

  exporting: boolean;
  exportProgress: number;
  setExporting: (b: boolean) => void;
  setExportProgress: (p: number) => void;

  history: ClipHistoryItem[];
  addToHistory: (item: ClipHistoryItem) => void;
  clearHistory: () => void;

  activeTool: "cut" | "text" | "memes" | "transcript" | "history";
  setActiveTool: (t: AppState["activeTool"]) => void;

  queuedSegments: Array<{ inPoint: number; outPoint: number; overlays: Overlay[] }>;
  queueSegment: (seg: { inPoint: number; outPoint: number; overlays: Overlay[] }) => void;
  clearQueuedSegments: () => void;
  removeQueuedSegment: (idx: number) => void;
}

export const useStore = create<AppState>((set) => ({
  mode: "clip",
  setMode: (m) => set({ mode: m }),

  sourceFile: null,
  sourceObjectURL: null,
  sourceTitle: null,
  sourceDuration: 0,
  setSource: (file, url, title) => set({ sourceFile: file, sourceObjectURL: url, sourceTitle: title ?? null }),
  clearSource: () => set({ sourceFile: null, sourceObjectURL: null, sourceTitle: null, sourceDuration: 0 }),
  setDuration: (d) => set({ sourceDuration: d }),

  capture: { active: false, method: null, hasAudio: false, cropRect: null },
  setCapture: (c) => set((s) => ({ capture: { ...s.capture, ...c } })),

  currentTime: 0,
  playing: false,
  playbackRate: 1,
  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (p) => set({ playing: p }),
  setPlaybackRate: (r) => set({ playbackRate: r }),

  clip: { inPoint: 0, outPoint: 10 },
  setClip: (c) => set((s) => ({ clip: { ...s.clip, ...c } })),

  overlays: [],
  selectedOverlayId: null,
  addOverlay: (o) => set((s) => ({ overlays: [...s.overlays, o] })),
  updateOverlay: (id, changes) =>
    set((s) => ({ overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...changes } : o)) })),
  removeOverlay: (id) => set((s) => ({ overlays: s.overlays.filter((o) => o.id !== id) })),
  selectOverlay: (id) => set({ selectedOverlayId: id }),

  aspectRatio: "9:16",
  setAspectRatio: (a) => set({ aspectRatio: a }),

  transcript: [],
  transcribing: false,
  setTranscript: (t) => set({ transcript: t }),
  setTranscribing: (b) => set({ transcribing: b }),

  suggestions: [],
  setSuggestions: (s) => set({ suggestions: s }),

  sceneCuts: [],
  setSceneCuts: (cuts) => set({ sceneCuts: cuts }),

  muteAudio: false,
  setMuteAudio: (b) => set({ muteAudio: b }),

  fillMode: "letterbox",
  setFillMode: (m) => set({ fillMode: m }),

  cropZoom: 1,
  setCropZoom: (z) => set({ cropZoom: z }),

  exporting: false,
  exportProgress: 0,
  setExporting: (b) => set({ exporting: b }),
  setExportProgress: (p) => set({ exportProgress: p }),

  history: [],
  addToHistory: (item) =>
    set((s) => ({ history: [item, ...s.history] })),
  clearHistory: () => set({ history: [] }),

  activeTool: "cut",
  setActiveTool: (t) => set({ activeTool: t }),

  queuedSegments: [],
  queueSegment: (seg) => set((s) => ({ queuedSegments: [...s.queuedSegments, seg] })),
  clearQueuedSegments: () => set({ queuedSegments: [] }),
  removeQueuedSegment: (idx) =>
    set((s) => ({ queuedSegments: s.queuedSegments.filter((_, i) => i !== idx) })),
}));

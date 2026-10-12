export type Mode = "clip" | "podcast" | "reality" | "sports";
export type AspectRatio = "9:16" | "1:1" | "16:9";
export type TextPreset = "CAPTION" | "IMPACT" | "QUOTE" | "SUBTITLE" | "HEADLINE";

export interface Overlay {
  id: string;
  type: "text" | "sticker" | "emoji" | "blur";
  x: number; // 0–1 relative
  y: number;
  width: number;
  height: number;
  rotation: number;
  // text-specific
  text?: string;
  preset?: TextPreset;
  color?: string;
  // sticker/emoji
  src?: string;
  emoji?: string;
  // blur region
  opacity?: number;
  // timed overlays (subtitle segments) — absolute video time in seconds
  startTime?: number;
  endTime?: number;
}

export interface ClipSelection {
  inPoint: number;  // seconds
  outPoint: number; // seconds
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: number;
  text: string;
  start: number;
  end: number;
  words?: TranscriptWord[];
  score?: number; // clip-worthiness score 0–1
}

export interface ClipSuggestion {
  segmentId: number;
  text: string;
  start: number;
  end: number;
  score: number;
  reason: string;
}

export interface ClipHistoryItem {
  id: string;
  mode: Mode;
  thumbnail: string; // base64 data URL
  inPoint: number;
  outPoint: number;
  duration: number;
  overlays: Overlay[];
  aspectRatio: AspectRatio;
  exportedAt: number;
  fileName?: string;
  exportUrl?: string;
  exportFileName?: string;
}

export interface CaptureState {
  active: boolean;
  method: "file" | "displayMedia" | "extension" | null;
  hasAudio: boolean;
  cropRect: { x: number; y: number; w: number; h: number } | null;
  sourceDomain?: string;
}

export interface SceneCut {
  timestamp: number;
}

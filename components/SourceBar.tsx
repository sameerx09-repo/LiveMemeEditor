import { useRef } from "react";
import { useStore } from "@/lib/store";
import { detectPlatform } from "@/lib/utils";

export default function SourceBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const setSource = useStore((s) => s.setSource);
  const clearSource = useStore((s) => s.clearSource);
  const sourceFile = useStore((s) => s.sourceFile);
  const sourceTitle = useStore((s) => s.sourceTitle);
  const capture = useStore((s) => s.capture);

  const handleFile = (file: File) => {
    clearSource();
    setSource(file, URL.createObjectURL(file));
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const displayName = sourceTitle
    ? (sourceTitle.length > 28 ? sourceTitle.slice(0, 28) + "…" : sourceTitle)
    : sourceFile
    ? (sourceFile.name.length > 20 ? sourceFile.name.slice(0, 20) + "…" : sourceFile.name)
    : null;

  return (
    <div
      className="flex items-center gap-2"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <button
        onClick={() => fileRef.current?.click()}
        className="px-3 py-2 bg-[#1a1a1a] border border-[#2e2e2e] hover:border-[#444] rounded-lg text-[#888] text-sm transition-colors whitespace-nowrap"
      >
        📁 Upload file
      </button>
      <input ref={fileRef} type="file" accept="video/*,audio/*" onChange={handleFileInput} className="hidden" />

      {displayName && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#1a2a1a] border border-[#2d4a2d] rounded-md text-xs text-[#4caf50] font-semibold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4caf50]" />
          {displayName}
        </div>
      )}

      {capture.active && !displayName && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#1a2a1a] border border-[#2d4a2d] rounded-md text-xs text-[#4caf50] font-semibold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4caf50] animate-pulse" />
          CAPTURING
        </div>
      )}
    </div>
  );
}

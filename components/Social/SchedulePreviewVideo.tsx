import { useEffect, useRef } from "react";

export default function SchedulePreviewVideo({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (video) video.src = src;
    return () => {
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);
  return <video ref={ref} aria-label="Scheduled clip preview" crossOrigin="anonymous" controls playsInline
    preload="metadata" poster={poster} src={src} className="w-full max-h-[50vh] bg-black rounded" />;
}

import type { SceneCut } from "./types";

const SAMPLE_FPS = 2;
const DIFF_THRESHOLD = 0.15; // 15% histogram change = scene cut

export async function detectSceneCuts(
  videoEl: HTMLVideoElement,
  onProgress?: (pct: number) => void
): Promise<SceneCut[]> {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext("2d")!;

  const duration = videoEl.duration;
  const cuts: SceneCut[] = [];
  let prevHist: number[] | null = null;
  let t = 0;

  const step = 1 / SAMPLE_FPS;

  const seekAndCapture = (time: number): Promise<number[]> =>
    new Promise((resolve) => {
      videoEl.currentTime = time;
      videoEl.onseeked = () => {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const hist = new Array(64).fill(0);
        for (let i = 0; i < data.length; i += 4) {
          const grey = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3 / 4);
          hist[grey]++;
        }
        const total = canvas.width * canvas.height;
        resolve(hist.map((v) => v / total));
      };
    });

  while (t <= duration) {
    const hist = await seekAndCapture(t);

    if (prevHist) {
      let diff = 0;
      for (let i = 0; i < hist.length; i++) {
        diff += Math.abs(hist[i] - prevHist[i]);
      }
      if (diff > DIFF_THRESHOLD) {
        cuts.push({ timestamp: t });
      }
    }

    prevHist = hist;
    t += step;
    onProgress?.(Math.min(99, (t / duration) * 100));
  }

  onProgress?.(100);
  return cuts;
}

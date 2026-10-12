import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loading) return loading;

  loading = (async () => {
    const instance = new FFmpeg();
    const base = "/ffmpeg";
    await instance.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg = instance;
    return instance;
  })();

  return loading;
}

/** Remux a WebM/any blob to MP4 (stream copy, no re-encode). */
export async function remuxToMp4(input: Blob): Promise<Blob> {
  const ff = await getFFmpeg();
  const inName = "input.webm";
  const outName = "output.mp4";

  await ff.writeFile(inName, await fetchFile(input));
  await ff.exec(["-y", "-i", inName, "-c", "copy", "-movflags", "+faststart", outName]);

  const data = await ff.readFile(outName);
  await ff.deleteFile(inName);
  await ff.deleteFile(outName);

  return new Blob([new Uint8Array(data as Uint8Array)], { type: "video/mp4" });
}

/** Merge a video blob with a separate audio blob into MP4. */
export async function mergeAudioVideo(video: Blob, audio: Blob): Promise<Blob> {
  const ff = await getFFmpeg();
  const vName = "video.webm";
  const aName = "audio.webm";
  const outName = "merged.mp4";

  await ff.writeFile(vName, await fetchFile(video));
  await ff.writeFile(aName, await fetchFile(audio));
  await ff.exec([
    "-y",
    "-i", vName,
    "-i", aName,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-movflags", "+faststart",
    outName,
  ]);

  const data = await ff.readFile(outName);
  await ff.deleteFile(vName);
  await ff.deleteFile(aName);
  await ff.deleteFile(outName);

  return new Blob([new Uint8Array(data as Uint8Array)], { type: "video/mp4" });
}

/** Concatenate multiple MP4/WebM blobs into one MP4. */
export async function stitchBlobs(blobs: Blob[]): Promise<Blob> {
  const ff = await getFFmpeg();
  const inputs: string[] = [];

  for (let i = 0; i < blobs.length; i++) {
    const name = `seg${i}.webm`;
    await ff.writeFile(name, await fetchFile(blobs[i]));
    inputs.push(name);
  }

  const listName = "list.txt";
  const listContent = inputs.map((n) => `file '${n}'`).join("\n");
  await ff.writeFile(listName, listContent);

  const outName = "stitched.mp4";
  await ff.exec(["-y", "-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", outName]);

  const data = await ff.readFile(outName);
  await ff.deleteFile(listName);
  for (const name of inputs) await ff.deleteFile(name);
  await ff.deleteFile(outName);

  return new Blob([new Uint8Array(data as Uint8Array)], { type: "video/mp4" });
}

/** Extract audio from a video blob as MP3 (for transcription). */
export async function extractAudio(video: Blob): Promise<Blob> {
  const ff = await getFFmpeg();
  const inName = "input.webm";
  const outName = "audio.mp3";

  await ff.writeFile(inName, await fetchFile(video));
  await ff.exec([
    "-y", "-i", inName,
    "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k",
    outName,
  ]);

  const data = await ff.readFile(outName);
  await ff.deleteFile(inName);
  await ff.deleteFile(outName);

  return new Blob([new Uint8Array(data as Uint8Array)], { type: "audio/mp3" });
}

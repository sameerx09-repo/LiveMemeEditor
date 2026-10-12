import { spawn } from "child_process";

const state = globalThis as typeof globalThis & { clipmemeMediaProcesses?: number };

export async function runMediaProcess(executable: string, args: string[]): Promise<void> {
  if ((state.clipmemeMediaProcesses ?? 0) >= 2) throw new Error("Media processing is busy. Please try again shortly.");
  state.clipmemeMediaProcesses = (state.clipmemeMediaProcesses ?? 0) + 1;
  try {
    await new Promise<void>((resolve, reject) => {
      const process = spawn(executable, args, {
        shell: false, timeout: 300000, killSignal: "SIGKILL", stdio: ["ignore", "ignore", "pipe"],
      });
      let diagnostic = "";
      process.stderr?.on("data", (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-8192); });
      process.once("error", () => reject(new Error("Could not start media processing")));
      process.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(signal ? "Media processing was stopped or exceeded its time limit" : `Media processing failed (${code}): ${diagnostic.slice(-400)}`));
      });
    });
  } finally {
    state.clipmemeMediaProcesses!--;
  }
}

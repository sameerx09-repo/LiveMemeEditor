import { EventEmitter } from "events";
import { spawn } from "child_process";
import { runMediaProcess } from "@/lib/media-process";
jest.mock("child_process", () => ({ spawn: jest.fn() }));
let child: EventEmitter & { stderr: EventEmitter };
beforeEach(() => {
  jest.clearAllMocks();
  child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
  jest.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
});
test("native processing has a hard deadline and never uses a shell", async () => {
  const pending = runMediaProcess("ffmpeg", ["-i", "fixture.webm"]);
  expect(spawn).toHaveBeenCalledWith("ffmpeg", ["-i", "fixture.webm"], expect.objectContaining({ shell: false, timeout: 300000, killSignal: "SIGKILL" }));
  child.emit("close", 0, null); await pending;
});
test("startup failures reject without an unhandled error event", async () => {
  const pending = runMediaProcess("missing", []);
  child.emit("error", new Error("ENOENT"));
  await expect(pending).rejects.toThrow("Could not start");
});
test("diagnostics exposed by process failures remain bounded", async () => {
  const pending = runMediaProcess("ffmpeg", []);
  child.stderr.emit("data", Buffer.from("x".repeat(100000)));
  child.emit("close", 1, null);
  await expect(pending).rejects.toThrow(/^Media processing failed \(1\): x{400}$/);
});
test("concurrent native work is bounded and slots recover after completion", async () => {
  const one = runMediaProcess("ffmpeg", []);
  const two = runMediaProcess("ffmpeg", []);
  await expect(runMediaProcess("ffmpeg", [])).rejects.toThrow("busy");
  child.emit("close", 0, null); await Promise.all([one, two]);
  const next = runMediaProcess("ffmpeg", []); child.emit("close", 0, null); await next;
});

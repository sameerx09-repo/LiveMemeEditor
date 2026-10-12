/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture({ frameCallbacks = true, send = jest.fn().mockResolvedValue(undefined) } = {}) {
  const intervals = new Map();
  const frames = new Map();
  const elements = [];
  const recorders = [];
  let nextId = 0;
  function element() {
    const handlers = new Map();
    const node = {
      style: {}, append: jest.fn(), appendChild: jest.fn(),
      addEventListener: (name, fn) => handlers.set(name, fn),
      removeEventListener: (name, fn) => { if (handlers.get(name) === fn) handlers.delete(name); },
      emit: (name) => handlers.get(name)?.({ stopPropagation() {}, preventDefault() {} }),
    };
    elements.push(node);
    return node;
  }
  const track = { stop: jest.fn() };
  class Stream {
    getVideoTracks() { return [track]; }
    getAudioTracks() { return []; }
    getTracks() { return [track]; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = "inactive"; recorders.push(this); }
    start() { this.state = "recording"; }
    requestData = jest.fn();
    stop = jest.fn(() => {
      this.state = "inactive";
      this.deliverStop();
    });
    deliverStop() {
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])]) });
        this.onstop();
      });
    }
  }
  const video = Object.assign(element(), {
    parentElement: element(), paused: false, seeking: false, duration: 10, currentTime: 0,
    captureStream: jest.fn(() => new Stream()), play: jest.fn().mockResolvedValue(undefined),
  });
  if (frameCallbacks) {
    video.requestVideoFrameCallback = (fn) => { const id = ++nextId; frames.set(id, fn); return id; };
    video.cancelVideoFrameCallback = (id) => frames.delete(id);
  }
  const context = {
    window: { location: { origin: "https://video.example" }, getComputedStyle: () => ({ position: "relative" }) },
    location: { hostname: "video.example" },
    document: { createElement: element },
    chrome: { storage: { sync: { get() {} } }, runtime: {
      onMessage: { addListener() {} }, sendMessage: (_message, cb) => cb({ error: "No tab audio" }),
    } },
    MediaStream: Stream, MediaRecorder: Recorder, Blob, console: { log() {}, warn() {}, error() {} },
    setInterval: (fn) => { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id), sendClip: send,
  };
  const source = fs.readFileSync(path.join(__dirname, "../chrome-ext/content.js"), "utf8")
    .replace("async function sendClip(", "async function unusedSendClip(")
    .replace("} // end: not editor page", "globalThis.inject = injectButton;\n} // end: not editor page");
  vm.runInNewContext(source, context);
  context.inject(video);
  const button = elements[3];
  return {
    video, track, button, recorders, send, frames, intervals,
    click: () => button.emit("click"),
    tick: () => [...intervals.values()].forEach(fn => fn()),
    frame: () => { const current = [...frames.values()]; frames.clear(); current.forEach(fn => fn()); },
  };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test("natural completion flushes before capture teardown and uploads final data once", async () => {
  const f = fixture();
  await f.click();
  const recorder = f.recorders[0];
  recorder.ondataavailable({ data: new Blob(["earlier"]) });
  f.video.currentTime = 9.95;
  f.frame();
  expect(recorder.stop).toHaveBeenCalledTimes(1);
  expect(f.track.stop).not.toHaveBeenCalled();
  f.video.emit("ended");
  await settle();
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0][0].size).toBe(12);
  expect(recorder.requestData).not.toHaveBeenCalled();
  expect(f.track.stop).toHaveBeenCalledTimes(1);
  expect(f.frames.size).toBe(0);
  expect(f.intervals.size).toBe(0);
  expect(f.video.play).not.toHaveBeenCalled();
});

test("manual Stop still flushes and uses the same video element capture", async () => {
  const f = fixture();
  await f.click();
  await f.click();
  await settle();
  expect(f.video.captureStream).toHaveBeenCalledTimes(1);
  expect(f.recorders[0].stop).toHaveBeenCalledTimes(1);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0][0].size).toBe(5);
});

test("resumes paused playback before obtaining capture tracks", async () => {
  const f = fixture();
  f.video.paused = true;
  f.video.play.mockImplementation(async () => { f.video.paused = false; });
  await f.click();
  expect(f.video.play).toHaveBeenCalledTimes(1);
  expect(f.video.play.mock.invocationCallOrder[0]).toBeLessThan(f.video.captureStream.mock.invocationCallOrder[0]);
});

test("timer fallback handles the end without requestVideoFrameCallback", async () => {
  const f = fixture({ frameCallbacks: false });
  await f.click();
  f.video.currentTime = 9.95;
  f.tick();
  await settle();
  expect(f.send).toHaveBeenCalledTimes(1);
});

test.each(["paused", "seeking", "live", "unknown duration", "not near end"])("does not prematurely stop %s video", async (mode) => {
  const f = fixture();
  await f.click();
  f.video.currentTime = 9.95;
  if (mode === "paused") f.video.paused = true;
  if (mode === "seeking") f.video.seeking = true;
  if (mode === "live") f.video.duration = Infinity;
  if (mode === "unknown duration") f.video.duration = NaN;
  if (mode === "not near end") f.video.currentTime = 8;
  f.frame();
  f.tick();
  expect(f.recorders[0].stop).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
});

test("ended remains a fallback if playback jumps straight to its end", async () => {
  const f = fixture();
  await f.click();
  f.video.currentTime = 10;
  f.video.emit("ended");
  await settle();
  expect(f.send).toHaveBeenCalledTimes(1);
});

test("recorder auto-stop clears state and allows another recording", async () => {
  const f = fixture();
  await f.click();
  f.recorders[0].state = "inactive";
  f.recorders[0].deliverStop();
  await settle();
  await f.click();
  expect(f.recorders).toHaveLength(2);
  expect(f.send).toHaveBeenCalledTimes(1);
});

test("cannot start another session while the old final data or upload is pending", async () => {
  let finishUpload;
  const send = jest.fn(() => new Promise(resolve => { finishUpload = resolve; }));
  const f = fixture({ send });
  await f.click();
  await f.click();
  await f.click();
  await settle();
  await f.click();
  expect(f.recorders).toHaveLength(1);
  finishUpload();
  await settle();
  await f.click();
  expect(f.recorders).toHaveLength(2);
});

test("recorder error does not stop tracks before the final data is delivered", async () => {
  const f = fixture();
  await f.click();
  f.recorders[0].onerror({ error: new Error("Encoder stopped") });
  expect(f.track.stop).not.toHaveBeenCalled();
  f.recorders[0].state = "inactive";
  f.recorders[0].deliverStop();
  await settle();
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.track.stop).toHaveBeenCalledTimes(1);
});

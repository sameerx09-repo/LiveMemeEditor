/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function uploadFixture(fetchImpl) {
  const download = jest.fn();
  const sendMessage = jest.fn();
  const remove = jest.fn();
  const logs = { info: jest.fn(), warn: jest.fn(), log: jest.fn() };
  const context = {
    window: { location: { origin: "https://www.bilibili.com" } },
    location: { hostname: "www.bilibili.com", origin: "https://www.bilibili.com" },
    chrome: {
      storage: { sync: { get() {} }, local: { get: (_key, cb) => cb({ clipmeme_auth_token: "private-fixture-token" }), remove } },
      runtime: { onMessage: { addListener() {} }, sendMessage },
    },
    console: logs,
    fetch: fetchImpl,
    document: { createElement: () => ({ click: download }) },
    URL: { createObjectURL: () => "blob:fixture" },
    setTimeout: jest.fn(),
  };
  const source = fs.readFileSync(path.join(__dirname, "../chrome-ext/content.js"), "utf8")
    .replaceAll("http://localhost:3000", "https://www.instantmemeeditandpost.online")
    .replace("const DIRECT_STORAGE_UPLOAD = false;", "const DIRECT_STORAGE_UPLOAD = true;")
    .replace("} // end: not editor page", "globalThis.testSendClip = sendClip;\n} // end: not editor page");
  vm.createContext(context);
  vm.runInContext(source, context);
  const btn = { style: {} };
  const timer = { style: {} };
  const blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2])], { type: "video/webm" });
  return { run: () => context.testSendClip(blob, btn, timer), logs, btn, download, sendMessage, remove };
}
const ticket = { clipId: "fixture-clip", uploadUrl: "https://fixture.r2.cloudflarestorage.com/bucket/clip?signature=private-fixture-signature" };

test("ticket-fetch failures identify the prepare step and retain the download fallback", async () => {
  const fixture = uploadFixture(jest.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await fixture.run();
  expect(fixture.logs.warn).toHaveBeenCalledWith("[ClipMeme] Upload failed:", "prepare upload: Failed to fetch");
  expect(fixture.btn.title).toBe("prepare upload: Failed to fetch");
  expect(fixture.download).toHaveBeenCalledTimes(1);
  expect(fixture.sendMessage).not.toHaveBeenCalled();
});
test("R2 network failures identify the storage step without leaking credentials or signed links", async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ticket }).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const fixture = uploadFixture(fetchImpl);
  await fixture.run();
  expect(fixture.logs.warn).toHaveBeenCalledWith("[ClipMeme] Upload failed:", "storage upload: Failed to fetch");
  expect(fixture.logs.info).toHaveBeenCalledWith(expect.stringContaining("Check R2 CORS"), "https://www.bilibili.com");
  const logs = JSON.stringify(Object.values(fixture.logs).map(mock => mock.mock.calls));
  expect(logs).not.toContain("private-fixture-token");
  expect(logs).not.toContain("private-fixture-signature");
  expect(fixture.download).toHaveBeenCalledTimes(1);
  expect(fixture.sendMessage).not.toHaveBeenCalled();
});
test("a completed PUT opens the editor and reports direct storage, not the relay", async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ticket }).mockResolvedValueOnce({ ok: true });
  const fixture = uploadFixture(fetchImpl);
  await fixture.run();
  expect(fetchImpl).toHaveBeenNthCalledWith(2, ticket.uploadUrl, expect.objectContaining({ method: "PUT", headers: { "Content-Type": "video/webm" } }));
  expect(fixture.logs.log).toHaveBeenCalledWith("[ClipMeme] uploaded directly to storage, clipId:", "fixture-clip");
  expect(fixture.sendMessage).toHaveBeenCalledWith({ type: "OPEN_CLIPMEMEEDITOR", url: "https://www.instantmemeeditandpost.online/?clip=fixture-clip" });
  expect(fixture.download).not.toHaveBeenCalled();
});
test("expired auth still prompts login without uploading or discarding the clip", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" });
  const fixture = uploadFixture(fetchImpl);
  await fixture.run();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fixture.remove).toHaveBeenCalledWith("clipmeme_auth_token");
  expect(fixture.sendMessage).toHaveBeenCalledWith({ type: "OPEN_CLIPMEMEEDITOR", url: "https://www.instantmemeeditandpost.online/" });
  expect(fixture.download).not.toHaveBeenCalled();
});

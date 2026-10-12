import { uploadInstagramClip } from "@/lib/instagram-upload-client";

const originalFetch = global.fetch;
const mockedFetch = jest.fn();
beforeEach(() => { mockedFetch.mockReset(); global.fetch = mockedFetch; });
afterEach(() => { global.fetch = originalFetch; });
function response(data: object, ok = true) { return { ok, json: async () => data }; }

test("uploads large clip bytes only to storage and never sends app credentials there", async () => {
  const blob = new Blob([new Uint8Array(5 * 1024 * 1024)], { type: "video/mp4" });
  mockedFetch.mockResolvedValueOnce(response({ uploadUrl: "https://storage.test/upload", uploadToken: "fixture-ticket" }))
    .mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(response({ mediaUrl: "https://editor.test/signed" }));
  expect(await uploadInstagramClip(blob, { Authorization: "Bearer fixture-session" })).toBe("https://editor.test/signed");
  const [prepare, put, complete] = mockedFetch.mock.calls;
  expect(JSON.parse(prepare[1].body)).toEqual({ action: "prepare", size: blob.size, contentType: "video/mp4" });
  expect(put).toEqual(["https://storage.test/upload", { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: blob }]);
  expect(JSON.parse(complete[1].body)).toEqual({ action: "complete", uploadToken: "fixture-ticket" });
  expect(complete[1].headers.Authorization).toBe("Bearer fixture-session");
});
test("does not upload if authorization or preparation fails", async () => {
  mockedFetch.mockResolvedValueOnce(response({ error: "Sign in" }, false));
  await expect(uploadInstagramClip(new Blob(["fixture"]), {})).rejects.toThrow("Sign in");
  expect(mockedFetch).toHaveBeenCalledTimes(1);
});
test("does not finalize a failed storage upload", async () => {
  mockedFetch.mockResolvedValueOnce(response({ uploadUrl: "https://storage.test/upload", uploadToken: "fixture" })).mockResolvedValueOnce({ ok: false });
  await expect(uploadInstagramClip(new Blob(["fixture"]), {})).rejects.toThrow("Storage upload failed");
  expect(mockedFetch).toHaveBeenCalledTimes(2);
});

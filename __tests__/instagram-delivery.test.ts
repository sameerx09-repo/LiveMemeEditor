import { publishInstagramMedia, signInstagramMediaUrl } from "@/lib/instagram";
import { getInstagramStorageDownloadUrl } from "@/lib/instagram-storage";
import { InstagramProcessingTimeoutError, INSTAGRAM_PROCESSING_WAIT_MS } from "@/lib/instagram-processing";

jest.mock("@/lib/instagram-storage", () => ({ getInstagramStorageDownloadUrl: jest.fn() }));
const originalFetch = global.fetch;
const originalSecret = process.env.INSTAGRAM_STATE_SECRET;
const mockedFetch = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  process.env.INSTAGRAM_STATE_SECRET = "fixture-state-secret";
  global.fetch = mockedFetch;
  jest.mocked(getInstagramStorageDownloadUrl).mockResolvedValue("https://storage.test/private-signed-video");
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.INSTAGRAM_STATE_SECRET;
  else process.env.INSTAGRAM_STATE_SECRET = originalSecret;
});
function response(data: object) { return { ok: true, json: async () => data }; }
function input() {
  return { accessToken: "fixture-ig-token", igUserId: "fixture-ig-account", caption: "Fixture caption",
    mediaUrl: signInstagramMediaUrl("https://instantmemeeditandpost.online", "social/instagram/alice/fixture.mp4") };
}
test("Instagram downloads directly from private storage, not the app or local tunnel", async () => {
  mockedFetch.mockResolvedValueOnce(response({ id: "container-one" }))
    .mockResolvedValueOnce(response({ status_code: "FINISHED" })).mockResolvedValueOnce(response({ id: "published-one" }));
  expect(await publishInstagramMedia(input())).toEqual({ creationId: "container-one", mediaId: "published-one" });
  const body = mockedFetch.mock.calls[0][1].body as URLSearchParams;
  expect(body.get("video_url")).toBe("https://storage.test/private-signed-video");
  expect(body.get("caption")).toBe("Fixture caption");
  expect(mockedFetch.mock.calls.every(call => !call[0].includes("instantmemeeditandpost.online"))).toBe(true);
});
test("rejects unsigned media before signing storage links or contacting Instagram", async () => {
  await expect(publishInstagramMedia({ ...input(), mediaUrl: "https://untrusted.test/video.mp4" })).rejects.toThrow("Upload the clip again");
  expect(getInstagramStorageDownloadUrl).not.toHaveBeenCalled();
  expect(mockedFetch).not.toHaveBeenCalled();
});
test("preserves processing details and container identity without leaking the media URL", async () => {
  mockedFetch.mockResolvedValueOnce(response({ id: "container-one" }))
    .mockResolvedValueOnce(response({ status_code: "ERROR", status: "Cannot download video https://storage.test/private?sig=fixture" }));
  await expect(publishInstagramMedia(input())).rejects.toThrow("Instagram container container-one processing error: Cannot download video [media URL]");
  expect(mockedFetch).toHaveBeenCalledTimes(2);
  expect(new URL(mockedFetch.mock.calls[1][0]).searchParams.get("fields")).toBe("status_code,status");
});

test("waits past the old one-minute limit without recreating or publishing early", async () => {
  jest.useFakeTimers();
  const start = Date.now();
  mockedFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/media")) return response({ id: "container-one" });
    if (url.endsWith("/media_publish")) return response({ id: "published-one" });
    return response({ status_code: Date.now() - start >= 90000 ? "FINISHED" : "IN_PROGRESS" });
  });
  const pending = publishInstagramMedia(input());
  await jest.advanceTimersByTimeAsync(60000);
  expect(mockedFetch.mock.calls.filter(([url]) => url.endsWith("/media_publish"))).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(30000);
  expect(await pending).toEqual({ creationId: "container-one", mediaId: "published-one" });
  expect(mockedFetch.mock.calls.filter(([url]) => url.endsWith("/media"))).toHaveLength(1);
  expect(mockedFetch.mock.calls.filter(([url]) => url.endsWith("/media_publish"))).toHaveLength(1);
});

test("processing deadline retains the container ID and never attempts publication", async () => {
  jest.useFakeTimers();
  mockedFetch.mockResolvedValueOnce(response({ id: "slow-container" }))
    .mockResolvedValue(response({ status_code: "IN_PROGRESS" }));
  const pending = publishInstagramMedia(input()).catch(error => error);
  await jest.advanceTimersByTimeAsync(INSTAGRAM_PROCESSING_WAIT_MS);
  const error = await pending;
  expect(error).toBeInstanceOf(InstagramProcessingTimeoutError);
  expect(error.creationId).toBe("slow-container");
  expect(error.message).toContain("Publishing was not attempted");
  expect(mockedFetch.mock.calls.filter(([url]) => url.endsWith("/media"))).toHaveLength(1);
  expect(mockedFetch.mock.calls.filter(([url]) => url.endsWith("/media_publish"))).toHaveLength(0);
});

test("retries transient status reads, not container creation or publishing", async () => {
  jest.useFakeTimers();
  mockedFetch.mockResolvedValueOnce(response({ id: "container-one" }))
    .mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new SyntaxError("HTML error page"); } })
    .mockResolvedValueOnce(response({ status_code: "FINISHED" }))
    .mockResolvedValueOnce(response({ id: "published-one" }));
  const pending = publishInstagramMedia(input());
  await jest.advanceTimersByTimeAsync(20000);
  expect(await pending).toEqual({ creationId: "container-one", mediaId: "published-one" });
  expect(mockedFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
});

test("authentication errors and expired containers fail without a publish retry", async () => {
  mockedFetch.mockResolvedValueOnce(response({ id: "container-one" }))
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: "Token expired" } }) });
  await expect(publishInstagramMedia(input())).rejects.toThrow("Token expired");
  expect(mockedFetch).toHaveBeenCalledTimes(2);
  mockedFetch.mockReset().mockResolvedValueOnce(response({ id: "container-two" }))
    .mockResolvedValueOnce(response({ status_code: "EXPIRED" }));
  await expect(publishInstagramMedia(input())).rejects.toThrow("processing expired");
  expect(mockedFetch).toHaveBeenCalledTimes(2);
});

test("saves container identity before polling and does not proceed if persistence fails", async () => {
  const save = jest.fn().mockRejectedValue(new Error("Database unavailable"));
  mockedFetch.mockResolvedValueOnce(response({ id: "container-one" }));
  await expect(publishInstagramMedia({ ...input(), onContainerCreated: save })).rejects.toThrow("Database unavailable");
  expect(save).toHaveBeenCalledWith("container-one");
  expect(mockedFetch).toHaveBeenCalledTimes(1);
});

test("same-slot videos can finish at different times without sharing containers", async () => {
  jest.useFakeTimers();
  const start = Date.now();
  let created = 0;
  mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/media")) return response({ id: ++created === 1 ? "slow" : "fast" });
    if (url.endsWith("/media_publish")) return response({ id: `${(init?.body as URLSearchParams).get("creation_id")}-published` });
    const requiredTime = url.includes("/slow?") ? 120000 : 30000;
    return response({ status_code: Date.now() - start >= requiredTime ? "FINISHED" : "IN_PROGRESS" });
  });
  const slow = publishInstagramMedia(input());
  const fast = publishInstagramMedia(input());
  await jest.advanceTimersByTimeAsync(120000);
  expect(await slow).toEqual({ creationId: "slow", mediaId: "slow-published" });
  expect(await fast).toEqual({ creationId: "fast", mediaId: "fast-published" });
  expect(created).toBe(2);
  expect(mockedFetch.mock.calls.filter(([url]) => url.endsWith("/media_publish"))).toHaveLength(2);
});

import { publishInstagramMedia, signInstagramMediaUrl } from "@/lib/instagram";
import { getInstagramStorageDownloadUrl } from "@/lib/instagram-storage";

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

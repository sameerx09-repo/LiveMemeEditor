import { signInstagramMediaUrl, verifyInstagramMediaSignature } from "@/lib/instagram";
import { createScheduledMediaReference, refreshScheduledMediaUrl } from "@/lib/instagram-scheduled-media";

jest.mock("@/lib/r2", () => ({ getR2Client: jest.fn() }));
const originalSecret = process.env.INSTAGRAM_STATE_SECRET;
const originalRedirect = process.env.INSTAGRAM_REDIRECT_URI;
const key = "social/instagram/alice/video.mp4";
function valid(url: string) {
  const params = new URL(url).searchParams;
  return verifyInstagramMediaSignature(params.get("key")!, params.get("expires")!, params.get("sig")!);
}
beforeEach(() => {
  process.env.INSTAGRAM_STATE_SECRET = "test-only-signing-key";
  delete process.env.INSTAGRAM_REDIRECT_URI;
  jest.spyOn(Date, "now").mockReturnValue(1800000000000);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.INSTAGRAM_STATE_SECRET;
  else process.env.INSTAGRAM_STATE_SECRET = originalSecret;
  if (originalRedirect === undefined) delete process.env.INSTAGRAM_REDIRECT_URI;
  else process.env.INSTAGRAM_REDIRECT_URI = originalRedirect;
});

test("a post due seven days later gets a new valid fetch URL", () => {
  const uploaded = signInstagramMediaUrl("https://editor.example", key);
  const reference = createScheduledMediaReference(uploaded, "alice", "https://editor.example");
  expect(new URL(reference).searchParams.has("sig")).toBe(false);
  jest.mocked(Date.now).mockReturnValue(1800000000000 + 7 * 86400000);
  expect(valid(uploaded)).toBe(false);
  const renewed = refreshScheduledMediaUrl(reference, "alice");
  expect(valid(renewed)).toBe(true);
  expect(new URL(renewed).searchParams.get("key")).toBe(key);
  expect(valid(refreshScheduledMediaUrl(uploaded, "alice"))).toBe(true);
});

test("rejects foreign files, forged signatures and unexpected origins", () => {
  const uploaded = signInstagramMediaUrl("https://editor.example", key);
  expect(() => createScheduledMediaReference(uploaded, "bob", "https://editor.example")).toThrow();
  expect(() => createScheduledMediaReference(uploaded + "bad", "alice", "https://editor.example")).toThrow();
  expect(() => createScheduledMediaReference(uploaded, "alice", "https://other.example")).toThrow();
  expect(() => refreshScheduledMediaUrl(uploaded, "bob")).toThrow();
});

test("uses the configured app origin if the tunnel address has changed", () => {
  const uploaded = signInstagramMediaUrl("https://old.example", key);
  process.env.INSTAGRAM_REDIRECT_URI = "https://current.example/api/instagram/callback";
  const renewed = refreshScheduledMediaUrl(uploaded, "alice");
  expect(new URL(renewed).origin).toBe("https://current.example");
  expect(valid(renewed)).toBe(true);
});

test("calendar previews use the current request origin instead of the publishing origin", () => {
  const uploaded = signInstagramMediaUrl("https://old.example", key);
  process.env.INSTAGRAM_REDIRECT_URI = "https://public.example/api/instagram/callback";
  const preview = refreshScheduledMediaUrl(uploaded, "alice", "http://localhost:3000");
  expect(new URL(preview).origin).toBe("http://localhost:3000");
  expect(valid(preview)).toBe(true);
  expect(() => refreshScheduledMediaUrl(uploaded, "bob", "http://localhost:3000")).toThrow();
});

import { parseHostname, ALLOWED_HOSTNAMES } from "@/lib/ytdl-utils";

function isAllowed(url: string): boolean {
  const h = parseHostname(url);
  return h !== null && ALLOWED_HOSTNAMES.has(h);
}

describe("SSRF allowlist — allowed hosts", () => {
  test.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=abc",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.instagram.com/reel/abc123/",
    "https://instagram.com/p/abc/",
    "https://www.tiktok.com/@user/video/123",
    "https://tiktok.com/t/abc",
    "https://twitter.com/user/status/123",
    "https://x.com/user/status/123",
    "https://www.twitter.com/user/status/123",
    "https://www.x.com/user/status/123",
    "https://vimeo.com/123456",
    "https://www.vimeo.com/123456",
  ])("allows %s", (url) => {
    expect(isAllowed(url)).toBe(true);
  });
});

describe("SSRF allowlist — blocked hosts", () => {
  test.each([
    ["arbitrary domain",       "https://evil.com/video.mp4"],
    ["localhost",              "http://localhost:5100/api/secret"],
    ["loopback IP",            "http://127.0.0.1/etc/passwd"],
    ["RFC-1918 192.168.x.x",   "http://192.168.1.1/admin"],
    ["RFC-1918 10.x.x.x",      "http://10.0.0.1/internal"],
    ["unknown youtube sub",    "https://evil.youtube.com/watch"],
    ["invalid URL",            "not-a-url"],
    ["empty string",           ""],
  ])("blocks %s (%s)", (_label, url) => {
    expect(isAllowed(url)).toBe(false);
  });
});

describe("parseHostname", () => {
  test("extracts hostname from valid URL", () => {
    expect(parseHostname("https://www.youtube.com/watch?v=abc")).toBe("www.youtube.com");
  });
  test("returns null for non-URL string", () => {
    expect(parseHostname("not-a-url")).toBeNull();
  });
  test("returns null for empty string", () => {
    expect(parseHostname("")).toBeNull();
  });
});

import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/instagram/connect";
import { requireAuth } from "@/lib/supabase-server";
import { buildInstagramAuthUrl, getInstagramRedirectUri } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
jest.mock("@/lib/supabase-server", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/instagram", () => ({ buildInstagramAuthUrl: jest.fn(), getInstagramRedirectUri: jest.fn() }));
jest.mock("@/lib/api-rate-limit", () => ({ checkApiRateLimit: jest.fn() }));
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({ id: "alice", email: "" });
  jest.mocked(checkApiRateLimit).mockResolvedValue(true);
  jest.mocked(getInstagramRedirectUri).mockReturnValue("https://editor.example/api/instagram/callback");
  jest.mocked(buildInstagramAuthUrl).mockReturnValue("https://www.instagram.com/oauth/authorize?fixture");
});
async function run(host = "editor.example") {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn(), getHeader: jest.fn(), end: jest.fn() };
  res.status.mockReturnValue(res);
  await handler({ method: "GET", headers: { host } } as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}
test("a same-host authenticated connection sets an expiring HttpOnly secure binding cookie", async () => {
  const res = await run();
  expect(buildInstagramAuthUrl).toHaveBeenCalledWith("alice", "https://editor.example/api/instagram/callback", expect.stringMatching(/^[a-f0-9]{64}$/));
  expect(res.status).toHaveBeenCalledWith(200);
  const cookie = res.setHeader.mock.calls.find(call => call[0] === "Set-Cookie")![1][0];
  expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Max-Age=600");
});
test("localhost-to-tunnel connection fails with actionable origin guidance", async () => {
  const res = await run("localhost:3000");
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("https://editor.example") });
  expect(buildInstagramAuthUrl).not.toHaveBeenCalled();
});
test("anonymous requests cannot generate account-linking state", async () => {
  jest.mocked(requireAuth).mockResolvedValue(null); await run();
  expect(buildInstagramAuthUrl).not.toHaveBeenCalled();
  expect(checkApiRateLimit).not.toHaveBeenCalled();
});

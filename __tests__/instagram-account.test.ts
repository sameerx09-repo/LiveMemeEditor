import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/instagram/account";
import { requireAuth } from "@/lib/supabase-server";
import { disconnectInstagramAccount, getDefaultInstagramAccount } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

jest.mock("@/lib/supabase-server", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/instagram", () => ({
  disconnectInstagramAccount: jest.fn(), getDefaultInstagramAccount: jest.fn(),
  getRequestBaseUrl: jest.fn(() => "https://editor.example.test"),
}));
jest.mock("@/lib/api-rate-limit", () => ({ checkApiRateLimit: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({ id: "alice", email: "" });
  jest.mocked(checkApiRateLimit).mockResolvedValue(true);
  jest.mocked(disconnectInstagramAccount).mockResolvedValue(undefined);
  jest.mocked(getDefaultInstagramAccount).mockResolvedValue({ id: "account", userId: "alice", igUserId: "ig-alice", username: "alice-ig", accessToken: "never-return-this-token" });
});

async function run(method = "GET") {
  const res = { status: jest.fn(), json: jest.fn(), end: jest.fn(), setHeader: jest.fn(), getHeader: jest.fn() };
  res.status.mockReturnValue(res);
  await handler({ method, headers: {}, body: { userId: "bob", igUserId: "ig-bob" }, query: { userId: "bob" } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

test("returns only the authenticated user's connection, without publishing credentials", async () => {
  const res = await run();
  expect(getDefaultInstagramAccount).toHaveBeenCalledWith("alice");
  expect(res.json).toHaveBeenCalledWith({ connected: true, username: "alice-ig", igUserId: "ig-alice" });
  expect(JSON.stringify(res.json.mock.calls)).not.toContain("never-return-this-token");
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});

test("an unlinked account is explicitly disconnected", async () => {
  jest.mocked(getDefaultInstagramAccount).mockResolvedValue(null);
  expect((await run()).json).toHaveBeenCalledWith({ connected: false, username: null, igUserId: null });
});

test("disconnect uses the verified owner, ignores supplied identifiers, and invalidates pending browser OAuth", async () => {
  const res = await run("DELETE");
  expect(checkApiRateLimit).toHaveBeenCalledWith("alice", "connect", res);
  expect(disconnectInstagramAccount).toHaveBeenCalledWith("alice");
  expect(getDefaultInstagramAccount).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ connected: false, username: null, igUserId: null });
  expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", [expect.stringContaining("Max-Age=0")]);
  expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", [expect.stringContaining("HttpOnly")]);
});

test.each(["GET", "DELETE"])("anonymous %s cannot read or disconnect an account", async method => {
  jest.mocked(requireAuth).mockResolvedValue(null);
  await run(method);
  expect(getDefaultInstagramAccount).not.toHaveBeenCalled();
  expect(disconnectInstagramAccount).not.toHaveBeenCalled();
});

test("a rate-limited disconnect cannot change account state", async () => {
  jest.mocked(checkApiRateLimit).mockResolvedValue(false);
  await run("DELETE");
  expect(disconnectInstagramAccount).not.toHaveBeenCalled();
});

test("database failures do not claim successful disconnection or leak details", async () => {
  jest.mocked(disconnectInstagramAccount).mockRejectedValue(new Error("private-token-and-database-details"));
  const res = await run("DELETE");
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("Could not disconnect") });
  expect(JSON.stringify(res.json.mock.calls)).not.toContain("private-token");
  expect(res.setHeader.mock.calls.some(call => call[0] === "Set-Cookie")).toBe(false);
});

test.each(["POST", "PUT"])("%s cannot alter connections", async method => {
  const res = await run(method);
  expect(res.status).toHaveBeenCalledWith(405);
  expect(res.setHeader).toHaveBeenCalledWith("Allow", "GET, DELETE");
  expect(requireAuth).not.toHaveBeenCalled();
});

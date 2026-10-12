import type { NextApiRequest, NextApiResponse } from "next";
import { createInstagramOAuthState, INSTAGRAM_OAUTH_COOKIE, readInstagramOAuthState } from "@/lib/instagram-oauth";
import callback from "@/pages/api/instagram/callback";
import { discoverInstagramAccount, exchangeCodeForToken, saveInstagramAccount } from "@/lib/instagram";
import { getCookieUser } from "@/lib/supabase-server";

jest.mock("@/lib/instagram", () => ({
  readInstagramOAuthState: jest.requireActual("@/lib/instagram-oauth").readInstagramOAuthState,
  getInstagramRedirectUri: jest.fn(() => "https://editor.example/api/instagram/callback"),
  discoverInstagramAccount: jest.fn(), exchangeCodeForToken: jest.fn(), saveInstagramAccount: jest.fn(),
}));
jest.mock("@/lib/supabase-server", () => ({ getCookieUser: jest.fn() }));
const originalSecret = process.env.INSTAGRAM_STATE_SECRET;
const binding = "a".repeat(64);
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers();
  process.env.INSTAGRAM_STATE_SECRET = "synthetic-state-signing-secret";
  jest.mocked(getCookieUser).mockResolvedValue({ id: "alice", email: "" });
  jest.mocked(exchangeCodeForToken).mockResolvedValue("synthetic-token");
  jest.mocked(discoverInstagramAccount).mockResolvedValue({ igUserId: "fixture-ig", username: "fixture" });
});
afterEach(() => {
  jest.useRealTimers();
  if (originalSecret === undefined) delete process.env.INSTAGRAM_STATE_SECRET; else process.env.INSTAGRAM_STATE_SECRET = originalSecret;
});
async function run(state = createInstagramOAuthState("alice", binding), cookie: string | undefined = binding) {
  const res = { setHeader: jest.fn(), getHeader: jest.fn(), redirect: jest.fn() };
  await callback({ method: "GET", query: { state, code: "fixture-code" }, cookies: { [INSTAGRAM_OAUTH_COOKIE]: cookie }, headers: {} } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}
test("normal callback links the authorized account and consumes the browser cookie", async () => {
  const res = await run();
  expect(saveInstagramAccount).toHaveBeenCalledWith("alice", expect.objectContaining({ accessToken: "synthetic-token" }));
  expect(res.redirect).toHaveBeenCalledWith("/?instagram=connected");
  expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", [expect.stringContaining("Max-Age=0")]);
  expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", [expect.stringContaining("HttpOnly")]);
});
test("authorization opened in a different browser cannot link an account", async () => {
  await run(createInstagramOAuthState("alice", binding), "b".repeat(64));
  expect(exchangeCodeForToken).not.toHaveBeenCalled(); expect(saveInstagramAccount).not.toHaveBeenCalled();
});
test("logged-out and switched-account callbacks cannot exchange codes", async () => {
  jest.mocked(getCookieUser).mockResolvedValue(null); await run();
  jest.mocked(getCookieUser).mockResolvedValue({ id: "bob", email: "" }); await run();
  expect(exchangeCodeForToken).not.toHaveBeenCalled();
});
test("expired state is rejected before contacting Meta", async () => {
  const state = createInstagramOAuthState("alice", binding);
  jest.advanceTimersByTime(600000); await run(state);
  expect(exchangeCodeForToken).not.toHaveBeenCalled();
});
test("a callback replay without the consumed cookie is rejected", async () => {
  const state = createInstagramOAuthState("alice", binding);
  await run(state); jest.mocked(exchangeCodeForToken).mockClear();
  await run(state, ""); expect(exchangeCodeForToken).not.toHaveBeenCalled();
});
test("tampered, truncated, extra-component and repeated state are rejected", () => {
  const state = createInstagramOAuthState("alice", binding);
  for (const bad of [state + "x", state.split(".")[0] + ".short", state + ".extra", [state, state]]) {
    expect(() => readInstagramOAuthState(bad, binding)).toThrow();
  }
});

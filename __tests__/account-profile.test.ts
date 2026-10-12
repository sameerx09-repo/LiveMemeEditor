import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/account/profile";
import { requireAuth } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/instagram";

jest.mock("@/lib/supabase-server", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/instagram", () => ({ createAdminClient: jest.fn() }));
const getUserById = jest.fn();
const user = { id: "alice", email: "alice@example.test", app_metadata: {}, user_metadata: { plan: "pro", secret: "private" } };

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({ id: "alice", email: "old@example.test" });
  jest.mocked(createAdminClient).mockReturnValue({ auth: { admin: { getUserById } } } as unknown as ReturnType<typeof createAdminClient>);
  getUserById.mockResolvedValue({ data: { user }, error: null });
});

async function run(method = "GET") {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  await handler({ method, headers: {}, query: { userId: "bob", plan: "pro" }, body: { id: "bob" } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

test("only returns the authenticated user's allowlisted profile; editable metadata cannot upgrade", async () => {
  const res = await run();
  expect(getUserById).toHaveBeenCalledWith("alice");
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ id: "alice", email: "alice@example.test", plan: "free", expiresAt: null });
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});
test("fresh admin metadata determines Pro, not session claims", async () => {
  getUserById.mockResolvedValue({ data: { user: { ...user, app_metadata: { plan: "pro", private: "never return this" } } }, error: null });
  const res = await run();
  expect(res.json).toHaveBeenCalledWith({ id: "alice", email: "alice@example.test", plan: "pro", expiresAt: null });
});
test("a removed Pro grant is reflected on the next request", async () => {
  getUserById.mockResolvedValueOnce({ data: { user: { ...user, app_metadata: { plan: "pro" } } }, error: null });
  expect((await run()).json).toHaveBeenCalledWith(expect.objectContaining({ plan: "pro" }));
  expect((await run()).json).toHaveBeenCalledWith(expect.objectContaining({ plan: "free" }));
});
test("anonymous requests never query the admin API", async () => {
  jest.mocked(requireAuth).mockImplementation(async (_req, res) => { res.status(401).json({ error: "Unauthorized" }); return null; });
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(createAdminClient).not.toHaveBeenCalled();
});
test("unsupported methods cannot update membership", async () => {
  const res = await run("POST");
  expect(res.status).toHaveBeenCalledWith(405);
  expect(res.setHeader).toHaveBeenCalledWith("Allow", "GET");
  expect(requireAuth).not.toHaveBeenCalled();
  expect(createAdminClient).not.toHaveBeenCalled();
});
test.each([
  { data: { user: null }, error: null },
  { data: { user: { ...user, id: "bob" } }, error: null },
  { data: { user }, error: { message: "sensitive upstream details" } },
])("lookup failures do not masquerade as Free or leak upstream data", async result => {
  getUserById.mockResolvedValue(result);
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: "Could not load your membership. Please try again." });
});
test("missing service configuration is a safe, retryable error", async () => {
  jest.mocked(createAdminClient).mockImplementation(() => { throw new Error("secret config"); });
  expect((await run()).status).toHaveBeenCalledWith(503);
});

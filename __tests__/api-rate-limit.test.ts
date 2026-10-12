import type { NextApiResponse } from "next";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { createAdminClient } from "@/lib/instagram";
jest.mock("@/lib/instagram", () => ({ createAdminClient: jest.fn() }));
const rpc = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  delete (globalThis as typeof globalThis & { clipmemeRateWindows?: unknown }).clipmemeRateWindows;
  jest.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
});
afterEach(() => jest.restoreAllMocks());
function response() {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res); return res;
}
test("local ceilings reject excess requests and isolate user/operation counters", async () => {
  const res = response();
  for (let i = 0; i < 10; i++) expect(await checkApiRateLimit("alice", "transcribe", res as unknown as NextApiResponse)).toBe(true);
  expect(await checkApiRateLimit("alice", "transcribe", res as unknown as NextApiResponse)).toBe(false);
  expect(res.status).toHaveBeenCalledWith(429);
  expect(await checkApiRateLimit("bob", "transcribe", res as unknown as NextApiResponse)).toBe(true);
  expect(await checkApiRateLimit("alice", "upload", res as unknown as NextApiResponse)).toBe(true);
});
test("production uses a shared atomic counter instead of local memory", async () => {
  jest.replaceProperty(process.env, "NODE_ENV", "production");
  rpc.mockResolvedValue({ data: true, error: null });
  expect(await checkApiRateLimit("alice", "upload", response() as unknown as NextApiResponse)).toBe(true);
  expect(rpc).toHaveBeenCalledWith("check_api_rate_limit", { p_user_id: "alice", p_operation: "upload", p_limit: 60, p_window_seconds: 3600 });
});
test("production quota denial is respected", async () => {
  jest.replaceProperty(process.env, "NODE_ENV", "production");
  rpc.mockResolvedValue({ data: false, error: null });
  const res = response();
  expect(await checkApiRateLimit("alice", "upload", res as unknown as NextApiResponse)).toBe(false);
  expect(res.status).toHaveBeenCalledWith(429);
});
test("missing production migration or database failure fails closed", async () => {
  jest.replaceProperty(process.env, "NODE_ENV", "production");
  rpc.mockResolvedValue({ data: null, error: { message: "Missing RPC" } });
  const res = response();
  expect(await checkApiRateLimit("alice", "upload", res as unknown as NextApiResponse)).toBe(false);
  expect(res.status).toHaveBeenCalledWith(503);
});

import { PassThrough } from "stream";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/receive-clip";
import { requireAuth } from "@/lib/supabase-server";

jest.mock("@/lib/supabase-server", () => ({ requireAuth: jest.fn() }));
jest.mock("child_process", () => ({ spawn: jest.fn(() => { throw new Error("fixture: remux unavailable"); }) }));
jest.mock("fs", () => ({ __esModule: true, default: { writeFileSync: jest.fn(), rmSync: jest.fn() } }));

function response() {
  const res = { status: jest.fn(), json: jest.fn(), end: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(requireAuth).mockResolvedValue({ id: "alice", email: "" });
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

async function upload() {
  const stream = new PassThrough();
  const req = Object.assign(stream, { method: "POST", query: {}, headers: {} });
  const res = response();
  const pending = handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
  await Promise.resolve();
  stream.end(Buffer.from("synthetic clip"));
  await pending;
  return res.json.mock.calls[0][0].id as string;
}
async function get(id: unknown) {
  const res = response();
  await handler({ method: "GET", query: { id } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

test("owner can retrieve a clip with a cryptographically random ID and no-store caching", async () => {
  const id = await upload();
  expect(id).toMatch(/^[a-f0-9]{32}$/);
  const res = await get(id);
  expect(res.end).toHaveBeenCalledWith(Buffer.from("synthetic clip"));
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});
test("a different authenticated user cannot retrieve a known clip ID", async () => {
  const id = await upload();
  jest.mocked(requireAuth).mockResolvedValue({ id: "bob", email: "" });
  const res = await get(id);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.end).not.toHaveBeenCalled();
});
test("malformed and repeated IDs do not return media", async () => {
  expect((await get(["a", "b"])).status).toHaveBeenCalledWith(404);
  expect((await get("invalid")).status).toHaveBeenCalledWith(404);
});
test("clips expire after ten minutes", async () => {
  const id = await upload();
  jest.advanceTimersByTime(10 * 60 * 1000);
  expect((await get(id)).status).toHaveBeenCalledWith(404);
});
test("unauthenticated callers cannot retrieve media", async () => {
  jest.mocked(requireAuth).mockResolvedValue(null);
  const res = await get("a".repeat(32));
  expect(res.end).not.toHaveBeenCalled();
});

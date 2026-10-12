import type { NextApiRequest, NextApiResponse } from "next";
import publish from "@/pages/api/instagram/publish";
import upload from "@/pages/api/instagram/upload";
import directUpload from "@/pages/api/instagram/upload-direct";
import schedule from "@/pages/api/instagram/schedule";
import { requireAuth } from "@/lib/supabase-server";
import { createAdminClient, getDefaultInstagramAccount, publishInstagramMedia, uploadInstagramMedia } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { prepareInstagramUpload, completeInstagramUpload } from "@/lib/instagram-storage";
import { getAccountProfile } from "@/lib/membership-server";

jest.mock("@/lib/supabase-server", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/instagram", () => ({
  createAdminClient: jest.fn(), getDefaultInstagramAccount: jest.fn(),
  publishInstagramMedia: jest.fn(), uploadInstagramMedia: jest.fn(),
  getRequestBaseUrl: jest.fn(() => "https://editor.example.test"),
  signInstagramMediaUrl: jest.fn(() => "signed-media"),
}));
jest.mock("@/lib/api-rate-limit", () => ({ checkApiRateLimit: jest.fn() }));
jest.mock("@/lib/instagram-storage", () => ({ prepareInstagramUpload: jest.fn(), completeInstagramUpload: jest.fn() }));
jest.mock("@/lib/instagram-scheduled-media", () => ({
  createScheduledMediaReference: jest.fn(() => "owned-reference"),
  refreshScheduledMediaUrl: jest.fn(() => "fresh-url"),
}));
jest.mock("@/lib/instagram-scheduler-status", () => ({ getInstagramSchedulerStatus: jest.fn(() => ({ enabled: true, message: "Active" })) }));

const getUserById = jest.fn();
const from = jest.fn();
const user = { id: "alice", email: "alice@example.test", app_metadata: {}, user_metadata: { plan: "pro" } };
const routes = [
  ["publish", publish, {}],
  ["upload", upload, {}],
  ["prepare", directUpload, { action: "prepare", size: 100, contentType: "video/mp4" }],
  ["complete", directUpload, { action: "complete", uploadToken: "fixture" }],
  ["schedule", schedule, {}],
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({ id: "alice", email: "" });
  jest.mocked(createAdminClient).mockReturnValue({ auth: { admin: { getUserById } }, from } as unknown as ReturnType<typeof createAdminClient>);
  getUserById.mockResolvedValue({ data: { user }, error: null });
  jest.mocked(checkApiRateLimit).mockResolvedValue(true);
  jest.mocked(getDefaultInstagramAccount).mockResolvedValue({ id: "ig-account", igUserId: "ig-alice", accessToken: "fixture" } as Awaited<ReturnType<typeof getDefaultInstagramAccount>>);
  jest.mocked(publishInstagramMedia).mockResolvedValue({ creationId: "container", mediaId: "media" });
  jest.mocked(prepareInstagramUpload).mockResolvedValue({ uploadUrl: "signed-put" } as Awaited<ReturnType<typeof prepareInstagramUpload>>);
  jest.mocked(completeInstagramUpload).mockResolvedValue({ key: "owned-key" } as Awaited<ReturnType<typeof completeInstagramUpload>>);
});

async function run(handler: typeof publish, body: object = {}, method = "POST") {
  const res = { status: jest.fn(), json: jest.fn(), end: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  const req = { method, headers: {}, body: { userId: "bob", plan: "pro", mediaUrl: "signed-media", igUserId: "ig-alice", caption: "Caption", scheduledAt: "2999-01-01T08:00:00Z", ...body }, on: jest.fn() };
  await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return { res, req };
}

test.each(routes)("Free cannot %s, even with forged body and editable Pro metadata", async (_name, handler, body) => {
  const { res, req } = await run(handler, body);
  expect(getUserById).toHaveBeenCalledWith("alice");
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ code: "PRO_REQUIRED", error: "Instagram posting and scheduling require Pro." });
  expect(checkApiRateLimit).not.toHaveBeenCalled();
  expect(getDefaultInstagramAccount).not.toHaveBeenCalled();
  expect(publishInstagramMedia).not.toHaveBeenCalled();
  expect(uploadInstagramMedia).not.toHaveBeenCalled();
  expect(prepareInstagramUpload).not.toHaveBeenCalled();
  expect(completeInstagramUpload).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
  expect(req.on).not.toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});

test.each(routes)("anonymous requests cannot %s or query membership", async (_name, handler, body) => {
  jest.mocked(requireAuth).mockResolvedValue(null);
  await run(handler, body);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(publishInstagramMedia).not.toHaveBeenCalled();
});

test.each(routes)("membership failure blocks %s without leaking upstream details", async (_name, handler, body) => {
  getUserById.mockRejectedValue(new Error("private upstream credentials"));
  const { res } = await run(handler, body);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ code: "MEMBERSHIP_UNAVAILABLE", error: "Could not load your membership. Please try again." });
  expect(checkApiRateLimit).not.toHaveBeenCalled();
});

test.each(["2000-01-01T00:00:00Z", "bad-date"])("expired or invalid Pro expiry cannot publish: %s", async expiry => {
  getUserById.mockResolvedValue({ data: { user: { ...user, app_metadata: { plan: "pro", plan_expires_at: expiry } } }, error: null });
  expect((await run(publish)).res.status).toHaveBeenCalledWith(403);
  expect(publishInstagramMedia).not.toHaveBeenCalled();
});

test("active Pro can publish and a subsequent downgrade is enforced immediately", async () => {
  getUserById.mockResolvedValueOnce({ data: { user: { ...user, app_metadata: { plan: "pro" } } }, error: null });
  expect((await run(publish)).res.status).toHaveBeenCalledWith(200);
  expect(publishInstagramMedia).toHaveBeenCalledTimes(1);
  expect((await run(publish)).res.status).toHaveBeenCalledWith(403);
  expect(publishInstagramMedia).toHaveBeenCalledTimes(1);
});

test.each(["prepare", "complete"])("active Pro retains direct upload %s", async action => {
  getUserById.mockResolvedValue({ data: { user: { ...user, app_metadata: { plan: "pro", plan_expires_at: "2999-01-01T00:00:00Z" } } }, error: null });
  const { res } = await run(directUpload, { action, size: 100, contentType: "video/mp4", uploadToken: "fixture" });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(action === "prepare" ? prepareInstagramUpload : completeInstagramUpload).toHaveBeenCalledTimes(1);
});

test("Free users can still read their own schedule", async () => {
  const query = { select: jest.fn(), eq: jest.fn(), order: jest.fn(), limit: jest.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [], error: null }); from.mockReturnValue(query);
  expect((await run(schedule, {}, "GET")).res.status).toHaveBeenCalledWith(200);
  expect(query.eq).toHaveBeenCalledWith("user_id", "alice");
  expect(getUserById).not.toHaveBeenCalled();
});

test("active Pro retains schedule creation with the authenticated owner", async () => {
  getUserById.mockResolvedValue({ data: { user: { ...user, app_metadata: { plan: "pro" } } }, error: null });
  const query = { insert: jest.fn(), select: jest.fn(), single: jest.fn() };
  query.insert.mockReturnValue(query); query.select.mockReturnValue(query);
  query.single.mockResolvedValue({ data: { id: "new-post" }, error: null }); from.mockReturnValue(query);
  expect((await run(schedule)).res.status).toHaveBeenCalledWith(200);
  expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "alice", status: "scheduled" }));
  expect(publishInstagramMedia).not.toHaveBeenCalled();
});

test("a mismatched admin response fails closed", async () => {
  getUserById.mockResolvedValue({ data: { user: { ...user, id: "bob", app_metadata: { plan: "pro" } } }, error: null });
  await expect(getAccountProfile("alice")).rejects.toThrow("Could not load your membership.");
});

test.each([["publish", publish], ["schedule", schedule]] as const)("an account switch during upload cannot silently redirect %s to the new Instagram account", async (_name, handler) => {
  getUserById.mockResolvedValue({ data: { user: { ...user, app_metadata: { plan: "pro" } } }, error: null });
  const { res } = await run(handler, { igUserId: "ig-previous-account" });
  expect(res.status).toHaveBeenCalledWith(409);
  expect(publishInstagramMedia).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
});

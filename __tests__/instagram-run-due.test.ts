import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/instagram/run-due";
import { createAdminClient, publishInstagramMedia } from "@/lib/instagram";
import { refreshScheduledMediaUrl } from "@/lib/instagram-scheduled-media";

jest.mock("@/lib/instagram", () => ({ createAdminClient: jest.fn(), publishInstagramMedia: jest.fn() }));
jest.mock("@/lib/instagram-scheduled-media", () => ({ refreshScheduledMediaUrl: jest.fn() }));

const originalSecret = process.env.INSTAGRAM_CRON_SECRET;
const originalCutoff = process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE;
const platformKeys = ["VERCEL", "VERCEL_ENV", "INSTAGRAM_SCHEDULER_MODE", "CRON_SECRET", "INSTAGRAM_SCHEDULER_BATCH_SIZE"] as const;
const originalPlatform = Object.fromEntries(platformKeys.map(key => [key, process.env[key]]));
const post = { id: "post-one", user_id: "alice", caption: "Caption", media_url: "reference", scheduled_at: "2026-10-11T14:30:00Z", social_accounts: { ig_user_id: "ig-alice", access_token: "fixture" } };
let from: jest.Mock;
let query: { select: jest.Mock; eq: jest.Mock; lte: jest.Mock; gte: jest.Mock; order: jest.Mock; limit: jest.Mock };

beforeEach(() => {
  jest.resetAllMocks();
  process.env.INSTAGRAM_CRON_SECRET = "test-secret";
  delete process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE;
  for (const key of platformKeys) delete process.env[key];
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  query = { select: jest.fn(), eq: jest.fn(), lte: jest.fn(), gte: jest.fn(), order: jest.fn(), limit: jest.fn() };
  for (const method of [query.select, query.eq, query.lte, query.gte, query.order]) method.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [post], error: null });
  from = jest.fn().mockReturnValueOnce(query);
  jest.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
  jest.mocked(refreshScheduledMediaUrl).mockReturnValue("fresh-signed-url");
  jest.mocked(publishInstagramMedia).mockResolvedValue({ creationId: "container-one", mediaId: "media-one" });
});
afterEach(() => {
  for (const key of platformKeys) {
    if (originalPlatform[key] === undefined) delete process.env[key];
    else process.env[key] = originalPlatform[key];
  }
  jest.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.INSTAGRAM_CRON_SECRET;
  else process.env.INSTAGRAM_CRON_SECRET = originalSecret;
  if (originalCutoff === undefined) delete process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE;
  else process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE = originalCutoff;
});

function claim(data: { id: string } | null, error: { message: string } | null = null) {
  const builder = { update: jest.fn(), eq: jest.fn(), select: jest.fn(), maybeSingle: jest.fn() };
  builder.update.mockReturnValue(builder); builder.eq.mockReturnValue(builder); builder.select.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({ data, error });
  from.mockReturnValueOnce(builder);
  return builder;
}
function save(error: { message: string } | null = null) {
  const builder = { update: jest.fn(), eq: jest.fn().mockResolvedValue({ error }) };
  builder.update.mockReturnValue(builder);
  from.mockReturnValueOnce(builder);
  return builder;
}
async function run(authorization = "Bearer test-secret", method = "POST") {
  const res = { status: jest.fn(), json: jest.fn(), end: jest.fn() };
  res.status.mockReturnValue(res);
  await handler({ method, headers: { authorization } } as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

test("rejects unauthenticated requests without accessing posts", async () => {
  const res = await run("Bearer invalid");
  expect(res.status).toHaveBeenCalledWith(401);
  expect(createAdminClient).not.toHaveBeenCalled();
});

test("supports authenticated GET for Vercel Cron without disclosing credentials", async () => {
  delete process.env.INSTAGRAM_CRON_SECRET;
  process.env.CRON_SECRET = "vercel-fixture";
  query.limit.mockResolvedValue({ data: [], error: null });
  const res = await run("Bearer vercel-fixture", "GET");
  expect(res.json).toHaveBeenCalledWith({ ok: true, results: [] });
});
test("preview deployment cannot publish even with a valid cron credential", async () => {
  process.env.VERCEL = "1"; process.env.VERCEL_ENV = "preview";
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(createAdminClient).not.toHaveBeenCalled();
});
test("production without explicit activation cutoff cannot query or publish old posts", async () => {
  process.env.VERCEL = "1"; process.env.VERCEL_ENV = "production";
  process.env.INSTAGRAM_SCHEDULER_MODE = "external";
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(publishInstagramMedia).not.toHaveBeenCalled();
  expect(createAdminClient).not.toHaveBeenCalled();
});
test("production defaults to a bounded batch of ten eligible posts", async () => {
  process.env.VERCEL = "1"; process.env.VERCEL_ENV = "production";
  process.env.INSTAGRAM_SCHEDULER_MODE = "external";
  process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE = "2026-10-11T14:15:14Z";
  claim({ id: post.id }); save();
  await run();
  expect(query.limit).toHaveBeenCalledWith(10);
  expect(publishInstagramMedia).toHaveBeenCalledTimes(1);
});
test("publishes a claimed due post with a fresh media URL and saves the result", async () => {
  const claimed = claim({ id: post.id }); const saved = save();
  const res = await run();
  expect(query.eq).toHaveBeenCalledWith("status", "scheduled");
  expect(query.lte).toHaveBeenCalledWith("scheduled_at", expect.any(String));
  expect(claimed.eq).toHaveBeenCalledWith("status", "scheduled");
  expect(refreshScheduledMediaUrl).toHaveBeenCalledWith("reference", "alice");
  expect(publishInstagramMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "fresh-signed-url", caption: "Caption" }));
  expect(saved.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published", instagram_media_id: "media-one" }));
  expect(res.json).toHaveBeenCalledWith({ ok: true, results: [{ id: post.id, ok: true, mediaId: "media-one" }] });
});
test("does not publish a post already claimed by another worker", async () => {
  claim(null); await run();
  expect(publishInstagramMedia).not.toHaveBeenCalled();
  expect(from).toHaveBeenCalledTimes(2);
});
test("a failed claim does not overwrite another worker's post", async () => {
  claim(null, { message: "Claim failed" }); await run();
  expect(publishInstagramMedia).not.toHaveBeenCalled();
  expect(from).toHaveBeenCalledTimes(2);
});
test("records a provider error only for the post this worker claimed", async () => {
  claim({ id: post.id }); const saved = save();
  jest.mocked(publishInstagramMedia).mockRejectedValue(new Error("Token expired"));
  await run();
  expect(saved.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "Token expired" }));
});
test("does not mark a published post failed when saving its result fails", async () => {
  claim({ id: post.id }); save({ message: "Database unavailable" });
  const res = await run();
  expect(from).toHaveBeenCalledTimes(3);
  expect(res.json).toHaveBeenCalledWith({ ok: true, results: [expect.objectContaining({ ok: false, mediaId: "media-one", error: expect.stringContaining("Check Instagram before retrying") })] });
});
test("returns and logs database errors rather than silently losing a worker run", async () => {
  query.limit.mockResolvedValue({ data: null, error: { message: "Database unavailable" } });
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: "Database unavailable" });
  expect(publishInstagramMedia).not.toHaveBeenCalled();
});

test("old posts are excluded before claims or publishing even when returned by the query", async () => {
  process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE = "2026-10-11T14:15:14Z";
  query.limit.mockResolvedValue({ data: [{ ...post, scheduled_at: "2026-10-11T14:00:00Z" }], error: null });
  const res = await run();
  expect(query.gte).toHaveBeenCalledWith("scheduled_at", "2026-10-11T14:15:14.000Z");
  expect(publishInstagramMedia).not.toHaveBeenCalled();
  expect(from).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith({ ok: true, results: [] });
});

test("future-only activation still allows new eligible posts", async () => {
  process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE = "2026-10-11T14:15:14Z";
  claim({ id: post.id }); save();
  await run();
  expect(publishInstagramMedia).toHaveBeenCalledTimes(1);
});

test("an invalid cutoff blocks publishing instead of falling back to old posts", async () => {
  process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE = "invalid";
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(500);
  expect(publishInstagramMedia).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
});

test("a configured batch cap is enforced even if the query returns excess posts", async () => {
  process.env.INSTAGRAM_SCHEDULER_BATCH_SIZE = "2";
  query.limit.mockResolvedValue({ data: [post, { ...post, id: "post-two" }, { ...post, id: "excess" }], error: null });
  claim({ id: post.id }); claim({ id: "post-two" }); save(); save();
  await run();
  expect(query.limit).toHaveBeenCalledWith(2);
  expect(publishInstagramMedia).toHaveBeenCalledTimes(2);
  expect(from).toHaveBeenCalledTimes(5);
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Batch limit 2 reached"));
});

test("invalid batch configuration fails before querying or publishing", async () => {
  process.env.INSTAGRAM_SCHEDULER_BATCH_SIZE = "0";
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(500);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(publishInstagramMedia).not.toHaveBeenCalled();
});

test.each(["invalid", "2999-01-01T08:00:00Z"])("never claims an invalid or future scheduled instant: %s", async scheduledAt => {
  query.limit.mockResolvedValue({ data: [{ ...post, scheduled_at: scheduledAt }], error: null });
  const res = await run();
  expect(from).toHaveBeenCalledTimes(1);
  expect(publishInstagramMedia).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ ok: true, results: [] });
});

test("same-slot posts start concurrently with each user's own Instagram credentials", async () => {
  const bob = { ...post, id: "post-two", user_id: "bob", media_url: "bob-reference", social_accounts: { ig_user_id: "ig-bob", access_token: "bob-fixture" } };
  query.limit.mockResolvedValue({ data: [post, bob], error: null });
  claim({ id: post.id }); claim({ id: bob.id }); save(); save();
  let finishAlice!: (value: { creationId: string; mediaId: string }) => void;
  let finishBob!: (value: { creationId: string; mediaId: string }) => void;
  let bothStarted!: () => void;
  const started = new Promise<void>(resolve => { bothStarted = resolve; });
  jest.mocked(publishInstagramMedia)
    .mockImplementationOnce(() => new Promise(resolve => { finishAlice = resolve; }))
    .mockImplementationOnce(() => {
      bothStarted();
      return new Promise(resolve => { finishBob = resolve; });
    });
  const running = run();
  await started;
  expect(publishInstagramMedia).toHaveBeenNthCalledWith(1, expect.objectContaining({ accessToken: "fixture", igUserId: "ig-alice" }));
  expect(publishInstagramMedia).toHaveBeenNthCalledWith(2, expect.objectContaining({ accessToken: "bob-fixture", igUserId: "ig-bob" }));
  expect(refreshScheduledMediaUrl).toHaveBeenCalledWith("bob-reference", "bob");
  finishAlice({ creationId: "alice-container", mediaId: "alice-media" });
  finishBob({ creationId: "bob-container", mediaId: "bob-media" });
  const res = await running;
  expect(res.json).toHaveBeenCalledWith({ ok: true, results: [
    { id: post.id, ok: true, mediaId: "alice-media" },
    { id: bob.id, ok: true, mediaId: "bob-media" },
  ] });
});

test("one user's provider failure does not prevent another user's same-slot post", async () => {
  const bob = { ...post, id: "post-two", user_id: "bob", social_accounts: { ig_user_id: "ig-bob", access_token: "bob-fixture" } };
  query.limit.mockResolvedValue({ data: [post, bob], error: null });
  claim({ id: post.id }); claim({ id: bob.id });
  const failed = save(); const published = save();
  jest.mocked(publishInstagramMedia).mockRejectedValueOnce(new Error("Token expired"));
  const res = await run();
  expect(failed.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  expect(published.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
  expect(res.json).toHaveBeenCalledWith({ ok: true, results: [
    { id: post.id, ok: false, error: "Token expired" },
    { id: bob.id, ok: true, mediaId: "media-one" },
  ] });
});

test("a rejected failure-save does not abort other users' posts in the batch", async () => {
  const bob = { ...post, id: "post-two", user_id: "bob", social_accounts: { ig_user_id: "ig-bob", access_token: "bob-fixture" } };
  query.limit.mockResolvedValue({ data: [post, bob], error: null });
  claim({ id: post.id }); claim({ id: bob.id });
  const failed = save(); const published = save();
  failed.eq.mockRejectedValue(new Error("Database unreachable"));
  jest.mocked(publishInstagramMedia).mockRejectedValueOnce(new Error("Token expired"));
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(200);
  expect(published.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Could not save failure"));
  expect(res.json).toHaveBeenCalledWith({ ok: true, results: [
    { id: post.id, ok: false, error: "Token expired" },
    { id: bob.id, ok: true, mediaId: "media-one" },
  ] });
});

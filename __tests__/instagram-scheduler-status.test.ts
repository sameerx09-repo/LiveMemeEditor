import type { NextApiRequest, NextApiResponse } from "next";
import { getInstagramSchedulerBatchSize, getInstagramSchedulerStatus } from "@/lib/instagram-scheduler-status";
import schedule from "@/pages/api/instagram/schedule";
import status from "@/pages/api/instagram/scheduler-status";
import { requireAuth } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/instagram";
import { requireInstagramPro } from "@/lib/membership-server";

jest.mock("@/lib/supabase-server", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/instagram", () => ({ createAdminClient: jest.fn(), getDefaultInstagramAccount: jest.fn(), getRequestBaseUrl: jest.fn() }));
jest.mock("@/lib/instagram-scheduled-media", () => ({ createScheduledMediaReference: jest.fn(), refreshScheduledMediaUrl: jest.fn() }));
jest.mock("@/lib/membership-server", () => ({ requireInstagramPro: jest.fn() }));

const keys = ["INSTAGRAM_SCHEDULER_ENABLED", "INSTAGRAM_SCHEDULER_MANAGED", "INSTAGRAM_SCHEDULER_MODE", "INSTAGRAM_CRON_SECRET", "VERCEL", "VERCEL_ENV", "CRON_SECRET", "INSTAGRAM_SCHEDULER_NOT_BEFORE", "INSTAGRAM_SCHEDULER_BATCH_SIZE"] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(requireInstagramPro).mockResolvedValue(true);
  for (const key of keys) delete process.env[key];
  jest.mocked(requireAuth).mockResolvedValue({ id: "alice" } as Awaited<ReturnType<typeof requireAuth>>);
});
afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});
function response() {
  const res = { status: jest.fn(), json: jest.fn(), end: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}
test("scheduler is disabled by default", () => {
  expect(getInstagramSchedulerStatus()).toMatchObject({ enabled: false, mode: "disabled" });
});

test("batch defaults remain bounded locally and in production", () => {
  expect(getInstagramSchedulerBatchSize()).toBe(5);
  process.env.VERCEL = "1";
  expect(getInstagramSchedulerBatchSize()).toBe(10);
});

test.each(["1", "2", "10", "20"])("accepts configured whole-number batch size %s", value => {
  process.env.INSTAGRAM_SCHEDULER_BATCH_SIZE = value;
  expect(getInstagramSchedulerBatchSize()).toBe(Number(value));
});

test.each(["0", "21", "-1", "1.5", "NaN", "1e1", " 2"])("rejects unsafe batch configuration %s", value => {
  process.env.INSTAGRAM_SCHEDULER_BATCH_SIZE = value;
  expect(() => getInstagramSchedulerBatchSize()).toThrow("whole number from 1 to 20");
});

test("Vercel previews cannot activate cron publishing", () => {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "preview";
  process.env.INSTAGRAM_SCHEDULER_MODE = "external";
  process.env.INSTAGRAM_CRON_SECRET = "fixture";
  process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE = "2026-10-12T10:00:00Z";
  expect(getInstagramSchedulerStatus().enabled).toBe(false);
});
test("Vercel production requires explicit cutoff before external activation", () => {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.INSTAGRAM_SCHEDULER_MODE = "external";
  process.env.INSTAGRAM_CRON_SECRET = "fixture";
  expect(getInstagramSchedulerStatus().enabled).toBe(false);
  process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE = "2026-10-12T10:00:00Z";
  expect(getInstagramSchedulerStatus()).toMatchObject({ enabled: true, mode: "external" });
});
test("a flag without a launcher-managed worker cannot enable local scheduling", () => {
  process.env.INSTAGRAM_SCHEDULER_ENABLED = "true";
  process.env.INSTAGRAM_CRON_SECRET = "fixture";
  expect(getInstagramSchedulerStatus().enabled).toBe(false);
  process.env.INSTAGRAM_SCHEDULER_MANAGED = "true";
  expect(getInstagramSchedulerStatus()).toMatchObject({ enabled: true, mode: "local" });
});
test("external scheduling requires an explicit mode and worker credential", () => {
  process.env.INSTAGRAM_SCHEDULER_MODE = "external";
  expect(getInstagramSchedulerStatus().enabled).toBe(false);
  process.env.INSTAGRAM_CRON_SECRET = "fixture";
  expect(getInstagramSchedulerStatus()).toMatchObject({ enabled: true, mode: "external" });
});
test("disabled scheduling rejects a post before any database write", async () => {
  const res = response();
  await schedule({ method: "POST", body: { scheduledAt: new Date(Date.now() + 3600000).toISOString(), mediaUrl: "fixture" } } as NextApiRequest, res as unknown as NextApiResponse);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("Scheduler is off") });
  expect(createAdminClient).not.toHaveBeenCalled();
});
test("status endpoint requires authentication and never discloses a credential", async () => {
  process.env.INSTAGRAM_CRON_SECRET = "private-fixture";
  const res = response();
  await status({ method: "GET" } as NextApiRequest, res as unknown as NextApiResponse);
  expect(requireAuth).toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(JSON.stringify(res.json.mock.calls)).not.toContain("private-fixture");
  jest.mocked(requireAuth).mockResolvedValue(null);
  const unauthenticated = response();
  await status({ method: "GET" } as NextApiRequest, unauthenticated as unknown as NextApiResponse);
  expect(unauthenticated.json).not.toHaveBeenCalled();
});

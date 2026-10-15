import { manualReminderConfig, safeReturnTo, validateAudioUrl, validPostId } from "@/lib/manual-posts";
import { sendPostingReminder } from "@/lib/reminder-email";
import type { ManualPost } from "@/lib/manual-posts";
import fs from "node:fs";
import path from "node:path";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
beforeEach(() => { process.env.MANUAL_REMINDERS_ENABLED="true";process.env.MANUAL_REMINDERS_BASE_URL="https://app.example.test";
  process.env.MANUAL_REMINDERS_NOT_BEFORE="2020-01-01T00:00:00Z";process.env.RESEND_API_KEY="fixture";
  process.env.REMINDER_EMAIL_FROM="ClipMeme <reminders@example.test>";process.env.INSTAGRAM_CRON_SECRET="fixture"; });
afterEach(() => { process.env={...originalEnv};global.fetch=originalFetch; });

test.each(["RESEND_API_KEY","REMINDER_EMAIL_FROM","INSTAGRAM_CRON_SECRET","MANUAL_REMINDERS_NOT_BEFORE"])("missing %s disables reminders", key => {
  delete process.env[key];expect(manualReminderConfig().enabled).toBe(false);
});
test("requires explicit activation and a past cutoff", () => {
  process.env.MANUAL_REMINDERS_ENABLED="false";expect(manualReminderConfig().enabled).toBe(false);
  process.env.MANUAL_REMINDERS_ENABLED="true";process.env.MANUAL_REMINDERS_NOT_BEFORE="2999-01-01T00:00:00Z";
  expect(manualReminderConfig().enabled).toBe(false);
});
test.each(["javascript:alert(1)","https://user:password@example.test","ftp://example.test"])("rejects unsafe configured origin %s", url => {
  process.env.MANUAL_REMINDERS_BASE_URL=url;expect(manualReminderConfig().enabled).toBe(false);
});
test("accepts Instagram audio links and strips tracking", () => {
  expect(validateAudioUrl("https://instagram.com/reels/audio/123/?utm_source=test")).toBe("https://www.instagram.com/reels/audio/123/");
  expect(validateAudioUrl("")).toBe("");
});
test.each(["https://www.instagram.com.attacker.test/reels/audio/123/","javascript:alert(1)","https://user@instagram.com/reels/audio/123/","https://instagram.com/p/123/",123])("rejects unsafe audio link %s", url => {
  expect(() => validateAudioUrl(url)).toThrow();
});
const id="11111111-1111-4111-8111-111111111111";
test("return-to permits only a manual post path, never external destinations", () => {
  expect(safeReturnTo(`/manual-post/${id}`)).toBe(`/manual-post/${id}`);
  for (const value of ["//evil.test","https://evil.test","/\\evil.test",["/manual-post/"],"/manual-post/x?next=//evil.test"]) expect(safeReturnTo(value)).toBe("/");
  expect(validPostId(id)).toBe(true);expect(validPostId("x")).toBe(false);
});
test("emails use provider idempotency, private login-protected links and no media URLs", async () => {
  const fetchMock=jest.fn().mockResolvedValue({ok:true,json:async()=>({id:"email-receipt"})});global.fetch=fetchMock;
  const post={id,scheduled_at:"2026-10-15T05:00:00Z",media_url:"https://secret-media.test"} as ManualPost;
  expect(await sendPostingReminder(post,"owner@example.test")).toBe("email-receipt");
  const options=fetchMock.mock.calls[0][1];
  expect(options.headers["Idempotency-Key"]).toContain(`manual-post/${id}/`);
  const body=JSON.parse(options.body);
  expect(body.to).toEqual(["owner@example.test"]);
  expect(body.text).toContain(`https://app.example.test/manual-post/${id}`);
  expect(body.text).not.toContain("secret-media");
  expect(body.text).not.toContain("fixture");
});
test("provider errors never count as accepted emails", async () => {
  global.fetch=jest.fn().mockResolvedValue({ok:false});
  await expect(sendPostingReminder({id,scheduled_at:"2026-10-15T05:00:00Z"} as ManualPost,"owner@example.test")).rejects.toThrow("did not accept");
});
test("SQL queue is isolated, locks claims, caps retry age and restricts browser writes", () => {
  const sql=fs.readFileSync(path.join(process.cwd(),"supabase/manual-reminders.sql"),"utf8");
  expect(sql).toContain("for update skip locked");expect(sql).toContain("interval '15 minutes'");
  expect(sql).toContain("attempts < 3");expect(sql).toContain("interval '6 minutes'");
  expect(sql).toContain("revoke all on public.instagram_manual_posts from anon, authenticated");
  expect(sql).not.toContain("public.instagram_posts ");
});

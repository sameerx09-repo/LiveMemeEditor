import { readFileSync } from "node:fs";
import path from "node:path";

const setup = readFileSync(path.join(process.cwd(), "supabase/production-scheduler.sql"), "utf8");
const configuration = readFileSync(path.join(process.cwd(), "supabase/instagram-cron-configuration.sql"), "utf8");

// Source contracts only: executing these migrations still requires Supabase.
test("production setup creates an hourly India-aligned job inactive in one transaction", () => {
  expect(setup).toContain("'30 * * * *'");
  expect(setup).toMatch(/begin;[\s\S]+cron\.schedule\([\s\S]+cron\.alter_job\(jobid, active := false\)[\s\S]+configure_instagram_cron\(60, 'Asia\/Kolkata'\)[\s\S]+commit;/);
  expect(setup).toContain("Production cron already exists");
  expect(setup).toContain("https://instantmemeeditandpost.online/api/instagram/run-due");
  expect(setup).toContain("vault.decrypted_secrets");
});

test("cadence configuration preserves activation and is inaccessible to normal app users", () => {
  expect(configuration).toContain("security definer");
  expect(configuration).toContain("set search_path = ''");
  expect(configuration).toContain("revoke all on function public.configure_instagram_cron(integer, text) from public, anon, authenticated");
  expect(configuration).toContain("grant execute on function public.configure_instagram_cron(integer, text) to service_role");
  expect(configuration).toContain("cron.alter_job(v_job_id, schedule := v_expression)");
  expect(configuration).not.toMatch(/active\s*:=|update\s+public\.instagram_posts|cron\.unschedule/i);
});

test("cadence configuration validates clock intervals and UTC before offsetting minutes", () => {
  expect(configuration).toContain("60 % p_interval_minutes <> 0");
  expect(configuration).toContain("current_setting('cron.timezone', true)");
  expect(configuration).toContain("('UTC', 'Asia/Kolkata', 'Asia/Calcutta')");
  expect(configuration).toContain("else 330 end");
  expect(configuration).toContain("(m.minute + v_offset) % p_interval_minutes = 0");
});

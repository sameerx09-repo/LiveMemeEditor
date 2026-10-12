import { readFileSync } from "node:fs";
import path from "node:path";

const setup = readFileSync(path.join(process.cwd(), "supabase/production-scheduler.sql"), "utf8");
const configuration = readFileSync(path.join(process.cwd(), "supabase/instagram-cron-configuration.sql"), "utf8");
const controls = readFileSync(path.join(process.cwd(), "supabase/instagram-cron-controls.sql"), "utf8");

// Source contracts only: executing these migrations still requires Supabase.
test("production setup creates an hourly India-aligned job inactive in one transaction", () => {
  expect(setup).toContain("'30 * * * *'");
  expect(setup).toMatch(/begin;[\s\S]+cron\.schedule\([\s\S]+cron\.alter_job\(jobid, active := false\)[\s\S]+configure_instagram_cron\(60, 'Asia\/Kolkata'\)[\s\S]+commit;/);
  expect(setup).toContain("Production cron already exists");
  expect(setup).toContain("https://www.instantmemeeditandpost.online/api/instagram/run-due");
  expect(setup).toContain("vault.decrypted_secrets");
});

test("cron switch installation is atomic, admin-only and does not activate a job", () => {
  expect(controls).toMatch(/begin;[\s\S]+create or replace function public\.set_instagram_cron_enabled\(p_enabled boolean\)[\s\S]+commit;/);
  expect(controls).toContain("security definer");
  expect(controls).toContain("set search_path = ''");
  expect(controls).toContain("revoke all on function public.set_instagram_cron_enabled(boolean) from public, anon, authenticated");
  expect(controls).toContain("grant execute on function public.set_instagram_cron_enabled(boolean) to service_role");
  expect(controls).not.toMatch(/^select .*set_instagram_cron_enabled\(/m);
});

test("safe resume serializes changes and skips only overdue queued posts before activation", () => {
  expect(controls).toContain("if p_enabled is null then");
  expect(controls).toContain("pg_catalog.pg_advisory_xact_lock");
  expect(controls).toContain("where j.jobname = 'clipmeme-production-instagram';");
  expect(controls).toContain("if v_job_id is null then");
  expect(controls).toContain("v_now := pg_catalog.clock_timestamp()");
  expect(controls).toMatch(/if p_enabled and not v_was_active then[\s\S]+vault\.decrypted_secrets[\s\S]+update public\.instagram_posts[\s\S]+status = 'failed'[\s\S]+where status = 'scheduled' and scheduled_at <= v_now;[\s\S]+end if;[\s\S]+cron\.alter_job\(v_job_id, active := p_enabled\)/);
  expect(controls).toContain("get diagnostics v_skipped = row_count");
  expect(controls).not.toMatch(/cron\.(schedule|unschedule)\(|net\.http_post\(|delete from|truncate /i);
  expect(controls).not.toMatch(/alter_job\([^;]*(command|schedule)\s*:=/i);
});

test("cron switch requires no direct write or row-lock privileges on cron.job", () => {
  // Supabase permits SELECT plus cron.alter_job, not direct UPDATE on cron.job.
  expect(controls).not.toMatch(/\bfor\s+(update|no key update|share|key share)\b/i);
  expect(controls).not.toMatch(/\b(update|insert into|delete from|lock table)\s+cron\.job\b/i);
  expect(controls).not.toMatch(/\bgrant\b[^;]*\bon\s+(table\s+)?cron\.job\b/i);
  expect(controls).toMatch(/pg_advisory_xact_lock\([\s\S]+select j\.jobid, j\.active[\s\S]+cron\.alter_job\(v_job_id, active := p_enabled\)/);
});

test("deployment template and preflight use the same canonical production origin as cron", () => {
  const template = readFileSync(path.join(process.cwd(), ".env.production.example"), "utf8");
  const preflight = readFileSync(path.join(process.cwd(), "scripts/check-production.cjs"), "utf8");
  expect(template).toContain("APP_URL=https://www.instantmemeeditandpost.online");
  expect(template).toContain("INSTAGRAM_REDIRECT_URI=https://www.instantmemeeditandpost.online/api/instagram/callback");
  expect(preflight).toContain("app.href !== 'https://www.instantmemeeditandpost.online/'");
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

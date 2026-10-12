/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());
const required = ['APP_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_STATE_SECRET', 'INSTAGRAM_REDIRECT_URI'];
const errors = required.filter(key => !process.env[key]).map(key => `${key} is missing`);
try {
  const app = new URL(process.env.APP_URL);
  if (app.protocol !== 'https:' || app.hostname !== 'instantmemeeditandpost.online' || app.pathname !== '/') errors.push('APP_URL must be https://instantmemeeditandpost.online');
  if (process.env.INSTAGRAM_REDIRECT_URI !== `${app.origin}/api/instagram/callback`) errors.push('Instagram callback must match the production domain exactly');
} catch { errors.push('Production APP_URL is invalid'); }
const mode = process.env.INSTAGRAM_SCHEDULER_MODE;
const batchSize = process.env.INSTAGRAM_SCHEDULER_BATCH_SIZE;
if (batchSize && (!/^\d+$/.test(batchSize) || Number(batchSize) < 1 || Number(batchSize) > 20)) errors.push('INSTAGRAM_SCHEDULER_BATCH_SIZE must be a whole number from 1 to 20');
if (mode === 'external' || mode === 'vercel') {
  if (!process.env.INSTAGRAM_CRON_SECRET) errors.push('INSTAGRAM_CRON_SECRET is required to enable scheduling');
  if (!process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE || !Number.isFinite(Date.parse(process.env.INSTAGRAM_SCHEDULER_NOT_BEFORE))) errors.push('An explicit valid INSTAGRAM_SCHEDULER_NOT_BEFORE is required');
  if (mode === 'vercel' && process.env.CRON_SECRET !== process.env.INSTAGRAM_CRON_SECRET) errors.push('CRON_SECRET and INSTAGRAM_CRON_SECRET must match');
}
if (process.env.INSTAGRAM_SCHEDULER_ENABLED === 'true') errors.push('Disable the local scheduler flag in Vercel production settings');
for (const error of errors) console.error(`Configuration: ${error}`);
if (errors.length) process.exitCode = 1;
else console.log('Required production settings present. External services, grants, DNS and cron execution still need live verification.');

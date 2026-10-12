/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { loadEnvConfig } = require('@next/env');
const { startScheduler } = require('./instagram-scheduler.cjs');

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
loadEnvConfig(process.cwd(), mode === 'dev');
// Share an ephemeral credential with the child server without exposing it in logs or URLs.
const secret = process.env.INSTAGRAM_CRON_SECRET || randomBytes(32).toString('hex');
const schedulerEnabled = process.env.INSTAGRAM_SCHEDULER_ENABLED === 'true';
const nodeArgs = process.allowedNodeEnvironmentFlags.has('--use-system-ca') ? ['--use-system-ca'] : [];
const server = spawn(process.execPath, [...nodeArgs, require.resolve('next/dist/bin/next'), mode,
  ...(mode === 'dev' ? ['--webpack'] : []), '--port', '3000'], {
  stdio: 'inherit',
  env: { ...process.env, INSTAGRAM_CRON_SECRET: secret, INSTAGRAM_SCHEDULER_MANAGED: String(schedulerEnabled) },
});
const scheduler = schedulerEnabled ? startScheduler({ secret }) : null;
if (!scheduler) console.log('[Instagram scheduler] Disabled; review overdue posts before setting INSTAGRAM_SCHEDULER_ENABLED=true');

server.once('error', error => {
  scheduler?.stop();
  console.error(`[App startup] ${error.message}`);
  process.exitCode = 1;
});
server.once('exit', code => { scheduler?.stop(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  scheduler?.stop();
  server.kill(signal);
});

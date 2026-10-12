/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require('@next/env');

function startScheduler({ secret, baseUrl = 'http://127.0.0.1:3000', intervalMs = 30000, fetchImpl = fetch, logger = console }) {
  if (!secret) throw new Error('INSTAGRAM_CRON_SECRET is required for a standalone scheduler');
  const controller = new AbortController();
  let running = false;
  let stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const response = await fetchImpl(new URL('/api/instagram/run-due', baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(360000)]),
      });
      if (!response.ok) throw new Error(`Worker returned HTTP ${response.status}`);
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.results)) throw new Error('Invalid worker response');
      for (const result of data.results) {
        if (result.ok) logger.log(`[Instagram scheduler] Published ${result.id} (${result.mediaId})`);
        else logger.error(`[Instagram scheduler] Failed ${result.id}: ${result.error}`);
      }
    } catch (error) {
      if (!stopped) logger.error(`[Instagram scheduler] ${error.message}`);
    } finally { running = false; }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  logger.log(`[Instagram scheduler] Active; checking every ${intervalMs / 1000}s`);
  return {
    tick,
    stop() { stopped = true; clearInterval(timer); controller.abort(); },
  };
}

if (require.main === module) {
  loadEnvConfig(process.cwd());
  if (process.env.INSTAGRAM_SCHEDULER_ENABLED !== 'true') {
    console.error('[Instagram scheduler] Disabled. Explicitly enable INSTAGRAM_SCHEDULER_ENABLED after reviewing overdue posts.');
    process.exitCode = 1;
  } else {
    const scheduler = startScheduler({ secret: process.env.INSTAGRAM_CRON_SECRET });
    void scheduler.tick();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => scheduler.stop());
  }
}

module.exports = { startScheduler };

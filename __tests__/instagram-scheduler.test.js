/* eslint-disable @typescript-eslint/no-require-imports */
const { startScheduler } = require('../scripts/instagram-scheduler.cjs');

let scheduler;
beforeEach(() => jest.useFakeTimers());
afterEach(() => { scheduler?.stop(); scheduler = undefined; jest.useRealTimers(); });

function start(fetchImpl) {
  const logger = { log: jest.fn(), error: jest.fn() };
  scheduler = startScheduler({ secret: 'test-secret', fetchImpl, logger });
  return logger;
}

test('calls the protected worker automatically every 30 seconds', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, results: [] }) });
  start(fetchImpl);
  await jest.advanceTimersByTimeAsync(30000);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0].pathname).toBe('/api/instagram/run-due');
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer test-secret' } });
  scheduler.stop();
  await jest.advanceTimersByTimeAsync(60000);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('does not overlap a slow publishing request', async () => {
  let finish;
  const fetchImpl = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  start(fetchImpl);
  const request = scheduler.tick();
  await jest.advanceTimersByTimeAsync(90000);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  finish({ ok: true, json: async () => ({ ok: true, results: [] }) });
  await request;
  await jest.advanceTimersByTimeAsync(30000);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('logs worker failures and continues checking on the next interval', async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, status: 401 })
    .mockResolvedValue({ ok: true, json: async () => ({ ok: true, results: [
      { id: 'one', ok: true, mediaId: 'ig-one' }, { id: 'two', ok: false, error: 'Token expired' },
    ] }) });
  const logger = start(fetchImpl);
  await jest.advanceTimersByTimeAsync(60000);
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed two: Token expired'));
  expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Published one (ig-one)'));
});

test('refuses to run without a worker credential', () => {
  expect(() => startScheduler({})).toThrow('INSTAGRAM_CRON_SECRET');
});

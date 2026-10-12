/* eslint-disable @typescript-eslint/no-require-imports */
const { EventEmitter } = require('node:events');

const originalEnabled = process.env.INSTAGRAM_SCHEDULER_ENABLED;
const originalSecret = process.env.INSTAGRAM_CRON_SECRET;
let signals;
let spawn;
let startScheduler;
let child;
let worker;

beforeEach(() => {
  jest.resetModules();
  delete process.env.INSTAGRAM_SCHEDULER_ENABLED;
  delete process.env.INSTAGRAM_CRON_SECRET;
  signals = [];
  child = new EventEmitter();
  child.kill = jest.fn();
  worker = { stop: jest.fn() };
  spawn = jest.fn().mockReturnValue(child);
  startScheduler = jest.fn().mockReturnValue(worker);
  jest.doMock('node:child_process', () => ({ spawn }));
  jest.doMock('@next/env', () => ({ loadEnvConfig: jest.fn() }));
  jest.doMock('../scripts/instagram-scheduler.cjs', () => ({ startScheduler }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(process, 'once').mockImplementation((signal, listener) => { signals.push([signal, listener]); return process; });
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalEnabled === undefined) delete process.env.INSTAGRAM_SCHEDULER_ENABLED;
  else process.env.INSTAGRAM_SCHEDULER_ENABLED = originalEnabled;
  if (originalSecret === undefined) delete process.env.INSTAGRAM_CRON_SECRET;
  else process.env.INSTAGRAM_CRON_SECRET = originalSecret;
});

test('normal startup cannot publish unless scheduling was explicitly enabled', () => {
  require('../scripts/serve.cjs');
  expect(startScheduler).not.toHaveBeenCalled();
  expect(spawn.mock.calls[0][2].env.INSTAGRAM_SCHEDULER_MANAGED).toBe('false');
  expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--port', '3000']));
});
test('explicitly enabled startup shares a private generated secret with its server', () => {
  process.env.INSTAGRAM_SCHEDULER_ENABLED = 'true';
  require('../scripts/serve.cjs');
  const secret = spawn.mock.calls[0][2].env.INSTAGRAM_CRON_SECRET;
  expect(secret).toMatch(/^[a-f0-9]{64}$/);
  expect(startScheduler).toHaveBeenCalledWith({ secret });
  expect(spawn.mock.calls[0][2].env.INSTAGRAM_SCHEDULER_MANAGED).toBe('true');
});
test('keeps a configured worker secret and stops the worker when the server exits', () => {
  process.env.INSTAGRAM_SCHEDULER_ENABLED = 'true';
  process.env.INSTAGRAM_CRON_SECRET = 'configured-secret';
  require('../scripts/serve.cjs');
  expect(startScheduler).toHaveBeenCalledWith({ secret: 'configured-secret' });
  child.emit('exit', 0);
  expect(worker.stop).toHaveBeenCalled();
});
test('stopping the launcher stops both the scheduler and child server', () => {
  process.env.INSTAGRAM_SCHEDULER_ENABLED = 'true';
  require('../scripts/serve.cjs');
  signals.find(([signal]) => signal === 'SIGTERM')[1]();
  expect(worker.stop).toHaveBeenCalled();
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
});

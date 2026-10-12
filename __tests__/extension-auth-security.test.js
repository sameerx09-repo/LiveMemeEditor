const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function bridge(fetchImpl) {
  const listeners = {};
  const window = { location: { origin: "http://localhost:3000" }, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const storage = { set: jest.fn(), remove: jest.fn() };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../chrome-ext/editor-bridge.js"), "utf8"), { window, chrome: { storage: { local: storage } }, fetch: fetchImpl });
  const send = (data, origin = window.location.origin) => listeners.message({ source: window, origin, data });
  return { storage, send };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
test("stores only credentials returned by the authenticated API", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "verified-fixture" }) });
  const { storage, send } = bridge(fetchImpl); await settle();
  send({ type: "__CLIPMEME_TOKEN__", token: "forged-message" }); await settle();
  expect(storage.set).toHaveBeenCalledTimes(1);
  expect(storage.set).toHaveBeenCalledWith({ clipmeme_auth_token: "verified-fixture" });
});
test("logout clears the cached credential", async () => {
  const { storage, send } = bridge(jest.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "fixture" }) }));
  await settle(); send({ type: "__CLIPMEME_AUTH_CHANGED__", signedOut: true });
  expect(storage.remove).toHaveBeenCalledWith("clipmeme_auth_token");
});
test("a stale in-flight refresh cannot restore a token after logout", async () => {
  let resolve;
  const fetchImpl = jest.fn(() => new Promise(done => { resolve = done; }));
  const { storage, send } = bridge(fetchImpl);
  send({ type: "__CLIPMEME_AUTH_CHANGED__", signedOut: true });
  resolve({ ok: true, json: async () => ({ access_token: "old-fixture" }) }); await settle();
  expect(storage.set).not.toHaveBeenCalled();
});
test("unavailable/invalid session clears previously cached credentials", async () => {
  const { storage } = bridge(jest.fn().mockResolvedValue({ ok: false })); await settle();
  expect(storage.remove).toHaveBeenCalledWith("clipmeme_auth_token");
});
test("messages from a different origin cannot clear or refresh credentials", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "fixture" }) });
  const { storage, send } = bridge(fetchImpl); await settle();
  send({ type: "__CLIPMEME_AUTH_CHANGED__", signedOut: true }, "https://attacker.example");
  expect(storage.remove).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(1);
});

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = file => fs.readFileSync(path.join(__dirname, "../chrome-ext", file), "utf8");
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function welcome(token, fetchImpl = jest.fn()) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, textContent: "", addEventListener: jest.fn() });
    return nodes.get(id);
  };
  let changed;
  const storage = { get: jest.fn(async () => ({ clipmeme_auth_token: token })) };
  vm.runInNewContext(source("welcome.js"), {
    document: { getElementById: get, querySelectorAll: () => [] },
    window: { addEventListener: jest.fn() },
    chrome: { runtime: { getManifest: () => ({ version: "1.0" }) }, storage: {
      local: storage, onChanged: { addListener: handler => { changed = handler; } },
    } },
    fetch: fetchImpl, AbortController, setTimeout, clearTimeout,
  });
  return { get, storage, changed, fetchImpl };
}

test("welcome opens on first install only, not update or browser update", () => {
  let installed;
  const create = jest.fn();
  vm.runInNewContext(source("background.js"), { chrome: {
    runtime: { onInstalled: { addListener: fn => { installed = fn; } }, getURL: file => `chrome-extension://fixture/${file}`, onMessage: { addListener: jest.fn() } },
    storage: { onChanged: { addListener: jest.fn() } }, tabs: { create },
  } });
  installed({ reason: "update" }); installed({ reason: "chrome_update" });
  expect(create).not.toHaveBeenCalled();
  installed({ reason: "install" });
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({ url: "chrome-extension://fixture/welcome.html" });
});

test("first-time visitor is signed out without making an unauthenticated request", async () => {
  const ui = welcome(null); await settle();
  expect(ui.get("status").textContent).toBe("Not connected");
  expect(ui.get("plan").hidden).toBe(true);
  expect(ui.get("signin").href).toBe("http://localhost:3000/login");
  expect(ui.fetchImpl).not.toHaveBeenCalled();
  expect(ui.get("refresh").disabled).toBe(false);
});

test.each(["free", "pro"])("shows verified %s plan, not a locally supplied entitlement", async plan => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "fixture", email: "user@example.test", plan }) });
  const ui = welcome("fixture-token", fetchImpl); await settle();
  expect(ui.get("status").textContent).toBe("user@example.test");
  expect(ui.get("plan").textContent).toBe(plan === "pro" ? "Pro" : "Free");
  expect(ui.get("plan").hidden).toBe(false);
  expect(ui.get("signin").textContent).toBe("Manage account");
  expect(fetchImpl).toHaveBeenCalledWith("http://localhost:3000/api/account/profile", expect.objectContaining({ credentials: "omit", headers: { Authorization: "Bearer fixture-token" } }));
});

test("expired session offers website sign-in without deleting credentials", async () => {
  const ui = welcome("expired", jest.fn().mockResolvedValue({ status: 401 })); await settle();
  expect(ui.get("status").textContent).toBe("Session expired");
  expect(ui.get("plan").hidden).toBe(true);
  expect(ui.get("signin").href).toBe("http://localhost:3000/login");
});

test.each(["offline", "invalid"])("%s response is recoverable and does not claim a plan", async type => {
  const fetchImpl = type === "offline" ? jest.fn().mockRejectedValue(new Error("offline")) : jest.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: "pro" }) });
  const ui = welcome("fixture", fetchImpl); await settle();
  expect(ui.get("status").textContent).toBe("Could not check connection");
  expect(ui.get("plan").hidden).toBe(true);
  expect(ui.get("refresh").disabled).toBe(false);
});

test("logout during a profile request cannot restore the old account", async () => {
  let finish;
  const ui = welcome("old", jest.fn(() => new Promise(resolve => { finish = resolve; })));
  await settle();
  ui.storage.get.mockResolvedValue({});
  ui.changed({ clipmeme_auth_token: {} }, "local"); await settle();
  finish({ ok: true, json: async () => ({ id: "old", email: "old@example.test", plan: "pro" }) });
  await settle();
  expect(ui.get("status").textContent).toBe("Not connected");
  expect(ui.get("plan").hidden).toBe(true);
});

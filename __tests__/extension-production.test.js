/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const origin = "https://www.instantmemeeditandpost.online";

function buildInMemory() {
  const output = new Map();
  const mockFs = {
    ...fs,
    mkdirSync: jest.fn(),
    writeFileSync: (file, content) => output.set(path.basename(file), content),
    copyFileSync: (input, file) => output.set(path.basename(file), fs.readFileSync(input)),
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "scripts/build-extension.cjs"), "utf8"), {
    __dirname: path.join(root, "scripts"),
    require: name => name === "node:fs" ? mockFs : require(name),
    console: { log: jest.fn() },
  });
  return output;
}

test("production permissions, auth bridges, popup and editor navigation use the same HTTPS www origin", () => {
  const output = buildInMemory();
  const manifest = JSON.parse(output.get("manifest.json"));
  expect(manifest.host_permissions).toContain(`${origin}/*`);
  const bridges = manifest.content_scripts.filter(script => script.js.some(file => file.startsWith("editor-bridge")));
  expect(bridges).toHaveLength(2);
  for (const bridge of bridges) expect(bridge.matches).toEqual([`${origin}/*`]);
  expect(output.get("popup.js")).toContain(`fetch("${origin}/api/ping")`);
  expect(output.get("background.js")).toContain(`const CLIPMEMEEDITOR_URL = "${origin}";`);
  expect(output.get("content.js")).toContain(`const CLIPMEME_URL = "${origin}";`);
  expect(output.get("content.js")).toContain("const DIRECT_STORAGE_UPLOAD = true;");
  expect(output.get("welcome.js")).toContain(`const WEBSITE_URL = "${origin}";`);
  expect(output.get("welcome.html")).toContain(`href="${origin}/login"`);
  expect(output.get("welcome.html")).toContain(`href="${origin}/privacy"`);
  expect(output.has("welcome.css")).toBe(true);
  for (const content of output.values()) {
    if (typeof content === "string") {
      expect(content).not.toContain("http://localhost:3000");
      expect(content).not.toContain('"https://instantmemeeditandpost.online');
    }
  }
});

test("production conversion leaves capture logic and local extension source unchanged", () => {
  const file = path.join(root, "chrome-ext/content.js");
  const source = fs.readFileSync(file, "utf8");
  expect(source).toContain('const CLIPMEME_URL = "http://localhost:3000";');
  expect(buildInMemory().get("content.js")).toBe(source
    .replaceAll("http://localhost:3000", origin)
    .replace("const DIRECT_STORAGE_UPLOAD = false;", "const DIRECT_STORAGE_UPLOAD = true;")
    .replaceAll("running on :3000", "available online"));
  expect(fs.readFileSync(file, "utf8")).toBe(source);
});

test("production background only opens editor links on the configured origin", () => {
  let receive;
  const create = jest.fn();
  const chrome = {
    storage: { onChanged: { addListener: jest.fn() } },
    runtime: { id: "extension-fixture", onInstalled: { addListener: jest.fn() }, onMessage: { addListener: handler => { receive = handler; } } },
    tabs: { create },
  };
  vm.runInNewContext(buildInMemory().get("background.js"), { chrome });
  const sender = { id: "extension-fixture" };
  for (const url of ["http://localhost:3000/?clip=fixture", "https://instantmemeeditandpost.online/?clip=fixture", `${origin}.attacker.example/?clip=fixture`]) {
    receive({ type: "OPEN_CLIPMEMEEDITOR", url }, sender, jest.fn());
  }
  expect(create).not.toHaveBeenCalled();
  receive({ type: "OPEN_CLIPMEMEEDITOR", url: `${origin}/?clip=fixture` }, sender, jest.fn());
  expect(create).toHaveBeenCalledWith({ url: `${origin}/?clip=fixture` });
});

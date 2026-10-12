import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/auth/signup";
import { createApiClient } from "@/lib/supabase-server";

jest.mock("@/lib/supabase-server", () => ({ createApiClient: jest.fn() }));
const signUp = jest.fn();
const originalEnv = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  jest.replaceProperty(process, "env", { ...originalEnv, NODE_ENV: "production", SIGNUP_ENABLED: "true" });
  jest.mocked(createApiClient).mockReturnValue({ auth: { signUp } } as unknown as ReturnType<typeof createApiClient>);
  signUp.mockResolvedValue({ data: { user: { id: "new-user" }, session: { access_token: "never-return" } }, error: null });
});
afterEach(() => jest.restoreAllMocks());

async function run(overrides: Partial<NextApiRequest> = {}) {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  await handler({ method: "POST", headers: { host: "editor.example", origin: "https://editor.example", "content-type": "application/json" },
    body: { email: "user@example.test", password: "password123" }, ...overrides } as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}
test.each([undefined, "false", "", "TRUE"])("production flag %j rejects registration before accessing Auth", async value => {
  if (value === undefined) delete process.env.SIGNUP_ENABLED;
  else process.env.SIGNUP_ENABLED = value;
  const res = await run({ body: { email: "user@example.test", password: "password123", signupEnabled: true } });
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ error: "New account signup is currently disabled." });
  expect(createApiClient).not.toHaveBeenCalled();
});
test("GET cannot create a user", async () => {
  const res = await run({ method: "GET" });
  expect(res.status).toHaveBeenCalledWith(405);
  expect(res.setHeader).toHaveBeenCalledWith("Allow", "POST");
  expect(createApiClient).not.toHaveBeenCalled();
});
test("enabled signup forwards credentials only and never returns a session or metadata", async () => {
  const res = await run({ body: { email: " user@example.test ", password: " password123 ", options: { data: { plan: "pro" } } } });
  expect(signUp).toHaveBeenCalledWith({ email: "user@example.test", password: " password123 " });
  expect(res.json).toHaveBeenCalledWith({ ok: true });
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});
test("a stale signup page cannot bypass a flag disabled between requests", async () => {
  expect((await run()).status).toHaveBeenCalledWith(200);
  process.env.SIGNUP_ENABLED = "false";
  expect((await run()).status).toHaveBeenCalledWith(403);
  expect(signUp).toHaveBeenCalledTimes(1);
});
test.each([undefined, "null", "https://other.example", "https://editor.example/path", "javascript:alert(1)"])("rejects untrusted origin %j", async origin => {
  const res = await run({ headers: { host: "editor.example", origin, "content-type": "application/json" } });
  expect(res.status).toHaveBeenCalledWith(403);
  expect(signUp).not.toHaveBeenCalled();
});
test("localhost origin with its fixed port is supported", async () => {
  expect((await run({ headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json; charset=utf-8" } })).status).toHaveBeenCalledWith(200);
});
test("non-JSON submissions cannot use the registration endpoint", async () => {
  const res = await run({ headers: { host: "editor.example", origin: "https://editor.example", "content-type": "text/plain" } });
  expect(res.status).toHaveBeenCalledWith(415);
  expect(signUp).not.toHaveBeenCalled();
});
test.each([null, {}, { email: "invalid", password: "password123" }, { email: "user@example.test", password: "short" }, { email: ["user@example.test"], password: "password123" }])("malformed credentials fail before Auth", async body => {
  expect((await run({ body })).status).toHaveBeenCalledWith(400);
  expect(signUp).not.toHaveBeenCalled();
});
test("upstream rate limits are preserved without leaking details", async () => {
  signUp.mockResolvedValue({ error: { status: 429, message: "private provider details" } });
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(429);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain("private provider details");
});
test("provider/network failures are retryable and sanitized", async () => {
  signUp.mockRejectedValue(new Error("private request details"));
  const res = await run();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: "Signup is temporarily unavailable. Please try again later." });
});

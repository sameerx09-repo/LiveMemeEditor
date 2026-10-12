import type { NextApiRequest, NextApiResponse } from "next";
import { createApiClient, getCookieUser, requireAuth } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn() }));
jest.mock("@supabase/ssr", () => ({ ...jest.requireActual("@supabase/ssr"), createServerClient: jest.fn() }));
const getClaims = jest.fn();
const userId = "11111111-1111-4111-8111-111111111111";
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let claims: Record<string, unknown>;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture";
  claims = { iss: "https://project.supabase.co/auth/v1", sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 };
  getClaims.mockImplementation(async () => ({ data: { claims }, error: null }));
  jest.mocked(createClient).mockReturnValue({ auth: { getClaims } } as unknown as ReturnType<typeof createClient>);
  jest.mocked(createServerClient).mockReturnValue({ auth: { getClaims } } as unknown as ReturnType<typeof createServerClient>);
});
afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
});
function response() {
  const res = { status: jest.fn(), json: jest.fn(), getHeader: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}
async function authenticate(header = "Bearer fixture") {
  const res = response();
  const user = await requireAuth({ headers: { authorization: header } } as NextApiRequest, res as unknown as NextApiResponse);
  return { user, res };
}
test("uses supported Supabase signature verification for the configured project", async () => {
  expect((await authenticate()).user?.id).toBe(userId);
  expect(getClaims).toHaveBeenCalledWith("fixture");
});
test.each([
  { iss: "https://other.supabase.co/auth/v1" }, { aud: "other" }, { role: "service_role" },
  { sub: "not-a-user" }, { exp: 0 }, { exp: "9999999999" }, { nbf: 9999999999 }, { nbf: "bad" },
])("rejects signed tokens with unacceptable claims: %j", async (changes) => {
  Object.assign(claims, changes);
  const { user, res } = await authenticate();
  expect(user).toBeNull(); expect(res.status).toHaveBeenCalledWith(401);
});
test("rejects failed signature verification", async () => {
  getClaims.mockResolvedValue({ data: null, error: { message: "Invalid signature" } });
  expect((await authenticate()).user).toBeNull();
});
test("rejects malformed bearer headers before verification", async () => {
  expect((await authenticate("Bearer fixture extra")).user).toBeNull();
  expect(getClaims).not.toHaveBeenCalled();
});
test("verification network failure fails closed", async () => {
  getClaims.mockRejectedValue(new Error("unavailable"));
  expect((await authenticate()).user).toBeNull();
});
test("callback identity uses verified cookie claims", async () => {
  const user = await getCookieUser({ cookies: {} } as NextApiRequest, response() as unknown as NextApiResponse);
  expect(user?.id).toBe(userId); expect(getClaims).toHaveBeenCalledWith();
});
test("refresh and deletion cookie attributes are preserved alongside OAuth cookies", () => {
  const res = response(); res.getHeader.mockReturnValue(["oauth=fixture; HttpOnly"]);
  createApiClient({ cookies: {} } as NextApiRequest, res as unknown as NextApiResponse);
  const options = jest.mocked(createServerClient).mock.calls[0][2] as unknown as { cookies: { setAll: (cookies: unknown[]) => void } };
  options.cookies.setAll([{ name: "session", value: "", options: { path: "/", maxAge: 0, secure: true, sameSite: "lax" } }]);
  expect(res.setHeader).toHaveBeenCalledWith("Set-Cookie", ["oauth=fixture; HttpOnly", expect.stringContaining("Max-Age=0")]);
});

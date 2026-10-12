import { renderToStaticMarkup } from "react-dom/server";
import type { GetServerSidePropsContext } from "next";
import LoginPage, { getServerSideProps } from "@/pages/login";

jest.mock("next/router", () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("@/lib/supabase-browser", () => ({ createClient: () => ({ auth: {} }) }));
const originalEnv = process.env;
afterEach(() => jest.restoreAllMocks());

test("disabled signup renders sign-in only", () => {
  const html = renderToStaticMarkup(<LoginPage signupEnabled={false} />);
  expect(html).toContain("Sign in");
  expect(html).not.toContain("Sign up");
  expect(html).not.toContain("Create account");
  expect(html).toContain('autoComplete="current-password"');
});
test("enabled signup restores the signup tab", () => {
  expect(renderToStaticMarkup(<LoginPage signupEnabled={true} />)).toContain("Sign up");
});
test("production server props expose only a noncached boolean and default to disabled", async () => {
  jest.replaceProperty(process, "env", { ...originalEnv, NODE_ENV: "production" });
  delete process.env.SIGNUP_ENABLED;
  const setHeader = jest.fn();
  expect(await getServerSideProps({ res: { setHeader } } as unknown as GetServerSidePropsContext)).toEqual({ props: { signupEnabled: false } });
  expect(setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});
test("server props read the current environment on every request", async () => {
  jest.replaceProperty(process, "env", { ...originalEnv, NODE_ENV: "production", SIGNUP_ENABLED: "true" });
  const context = { res: { setHeader: jest.fn() } } as unknown as GetServerSidePropsContext;
  expect(await getServerSideProps(context)).toEqual({ props: { signupEnabled: true } });
  process.env.SIGNUP_ENABLED = "false";
  expect(await getServerSideProps(context)).toEqual({ props: { signupEnabled: false } });
});

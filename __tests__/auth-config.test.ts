import { isSignupEnabled } from "@/lib/auth-config";

test("production disables signup when the flag is absent", () => {
  expect(isSignupEnabled({ NODE_ENV: "production" })).toBe(false);
});
test("development preserves signup when the flag is absent", () => {
  expect(isSignupEnabled({ NODE_ENV: "development" })).toBe(true);
});
test.each(["production", "development", "test"] as const)("explicit true/false overrides the %s default", NODE_ENV => {
  expect(isSignupEnabled({ NODE_ENV, SIGNUP_ENABLED: "true" })).toBe(true);
  expect(isSignupEnabled({ NODE_ENV, SIGNUP_ENABLED: "false" })).toBe(false);
});
test.each(["", "TRUE", "False", "yes", "1", " true "])("invalid flag %j fails closed", SIGNUP_ENABLED => {
  expect(isSignupEnabled({ NODE_ENV: "production", SIGNUP_ENABLED })).toBe(false);
  expect(isSignupEnabled({ NODE_ENV: "development", SIGNUP_ENABLED })).toBe(false);
});

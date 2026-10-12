type SignupEnvironment = { SIGNUP_ENABLED?: string; NODE_ENV?: string };

export function isSignupEnabled(env: SignupEnvironment = process.env): boolean {
  if (env.SIGNUP_ENABLED === undefined) return env.NODE_ENV !== "production";
  // Invalid or blank values fail closed; only the literal true opts in.
  return env.SIGNUP_ENABLED === "true";
}

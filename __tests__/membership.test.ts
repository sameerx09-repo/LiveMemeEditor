import { resolveMembership } from "@/lib/membership";

const now = Date.parse("2026-10-12T12:00:00Z");

test.each([undefined, {}, { plan: "free" }, { plan: "paid" }, { plan: "PRO" }, { plan: true }])(
  "defaults unrecognized or missing membership to Free: %j", metadata => {
    expect(resolveMembership(metadata, now)).toEqual({ plan: "free", expiresAt: null });
  }
);
test("an admin-granted Pro plan without expiry is supported", () => {
  expect(resolveMembership({ plan: "pro" }, now)).toEqual({ plan: "pro", expiresAt: null });
});
test("normalizes a future expiry", () => {
  expect(resolveMembership({ plan: "pro", plan_expires_at: "2026-10-13T17:30:00+05:30" }, now))
    .toEqual({ plan: "pro", expiresAt: "2026-10-13T12:00:00.000Z" });
});
test.each(["2026-10-12T11:59:59Z", "2026-10-12T12:00:00Z", "invalid", "2026-13-12T12:00:00Z", "2026-10-13", 123, ""])(
  "expired or malformed Pro expiry fails closed: %j", expiry => {
    expect(resolveMembership({ plan: "pro", plan_expires_at: expiry }, now)).toEqual({ plan: "free", expiresAt: null });
  }
);

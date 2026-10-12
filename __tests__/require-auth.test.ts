import { requireAuth } from "@/lib/supabase-server";
import type { NextApiRequest, NextApiResponse } from "next";

function mockReqRes(authHeader?: string) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
    cookies: {},
    url: "/test",
  } as unknown as NextApiRequest;

  const jsonMock = jest.fn();
  let statusCode = 0;
  const res = {
    status: (code: number) => { statusCode = code; return res; },
    json: jsonMock,
  } as unknown as NextApiResponse;

  return { req, res, jsonMock, getStatus: () => statusCode };
}

describe("requireAuth", () => {
  test("rejects request with no Authorization header", async () => {
    const { req, res, jsonMock } = mockReqRes();
    const result = await requireAuth(req, res);
    expect(result).toBeNull();
    expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  test("rejects Basic auth scheme", async () => {
    const { req, res, jsonMock } = mockReqRes("Basic dXNlcjpwYXNz");
    const result = await requireAuth(req, res);
    expect(result).toBeNull();
    expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  test("rejects Bearer token with wrong number of parts", async () => {
    const { req, res, jsonMock } = mockReqRes("Bearer notajwt");
    const result = await requireAuth(req, res);
    expect(result).toBeNull();
    expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  test("rejects JWT with invalid signature", async () => {
    const header  = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "user-123",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const sig = Buffer.from("this-is-not-a-real-ec-signature").toString("base64url");
    const { req, res, jsonMock } = mockReqRes(`Bearer ${header}.${payload}.${sig}`);
    const result = await requireAuth(req, res);
    expect(result).toBeNull();
    expect(jsonMock).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  test("rejects JWT with expired payload (invalid sig path still returns null)", async () => {
    const header  = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "user-123",
      exp: 1000, // Jan 1970 — definitely expired
    })).toString("base64url");
    const sig = Buffer.from("fake-sig").toString("base64url");
    const { req, res } = mockReqRes(`Bearer ${header}.${payload}.${sig}`);
    const result = await requireAuth(req, res);
    expect(result).toBeNull();
  });
});

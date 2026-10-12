import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/instagram/schedule/[id]";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { createAdminClient, getScheduledInstagramAccount } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

jest.mock("@/lib/supabase-server", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/membership-server", () => ({ requireInstagramPro: jest.fn() }));
jest.mock("@/lib/instagram", () => ({ createAdminClient: jest.fn(), getScheduledInstagramAccount: jest.fn() }));
jest.mock("@/lib/api-rate-limit", () => ({ checkApiRateLimit: jest.fn() }));

const id = "11111111-1111-4111-8111-111111111111";
const oldTime = "2999-01-01T08:00:00Z";
const newTime = "2999-01-02T09:30:00.000Z";
const post = { id, status: "scheduled", scheduled_at: oldTime, social_account_id: "original-account" };
const from = jest.fn();
function builder() {
  const query = { select: jest.fn(), eq: jest.fn(), update: jest.fn(), delete: jest.fn(), maybeSingle: jest.fn() };
  for (const method of [query.select,query.eq,query.update,query.delete]) method.mockReturnValue(query);
  return query;
}
let read: ReturnType<typeof builder>;
let mutation: ReturnType<typeof builder>;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({ id: "alice", email: "alice@example.test" });
  jest.mocked(requireInstagramPro).mockResolvedValue(true);
  jest.mocked(checkApiRateLimit).mockResolvedValue(true);
  jest.mocked(getScheduledInstagramAccount).mockResolvedValue({ id: "original-account", userId: "alice", igUserId: "ig-alice", username: "alice", accessToken: "fixture" });
  read=builder();mutation=builder();
  read.maybeSingle.mockResolvedValue({ data: post, error: null });
  mutation.maybeSingle.mockResolvedValue({ data: { id, scheduled_at: newTime, status: "scheduled" }, error: null });
  from.mockReturnValueOnce(read).mockReturnValueOnce(mutation);
  jest.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
});

async function run(method="PATCH", body: object={}, scheduleId: unknown=id) {
  const res = { status: jest.fn(), json: jest.fn(), end: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  await handler({ method, headers: {}, query: { id: scheduleId }, body: { expectedScheduledAt: oldTime, scheduledAt: newTime, userId: "bob", socialAccountId: "other-account", mediaUrl: "forged", caption: "forged", ...body } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}

test("moves an owned queued post using the original account and conditional update, without changing its media", async () => {
  const res=await run();
  expect(res.status).toHaveBeenCalledWith(200);
  expect(requireInstagramPro).toHaveBeenCalledWith("alice",expect.anything());
  expect(read.eq).toHaveBeenCalledWith("id",id);
  expect(read.eq).toHaveBeenCalledWith("user_id","alice");
  expect(getScheduledInstagramAccount).toHaveBeenCalledWith("alice","original-account");
  expect(mutation.update).toHaveBeenCalledWith({scheduled_at:newTime,updated_at:expect.any(String)});
  expect(mutation.eq).toHaveBeenCalledWith("user_id","alice");
  expect(mutation.eq).toHaveBeenCalledWith("status","scheduled");
  expect(mutation.eq).toHaveBeenCalledWith("scheduled_at",oldTime);
  expect(mutation.delete).not.toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control","private, no-store");
});

test.each(["scheduled","failed"])("deletes only an owned %s post, including for Free users", async status => {
  read.maybeSingle.mockResolvedValue({data:{...post,status},error:null});
  expect((await run("DELETE")).status).toHaveBeenCalledWith(200);
  expect(requireInstagramPro).not.toHaveBeenCalled();
  expect(getScheduledInstagramAccount).not.toHaveBeenCalled();
  expect(mutation.delete).toHaveBeenCalledTimes(1);
  expect(mutation.eq).toHaveBeenCalledWith("id",id);
  expect(mutation.eq).toHaveBeenCalledWith("user_id","alice");
  expect(mutation.eq).toHaveBeenCalledWith("status",status);
  expect(mutation.eq).toHaveBeenCalledWith("scheduled_at",oldTime);
  expect(mutation.update).not.toHaveBeenCalled();
});

test.each(["PATCH","DELETE"])("%s cannot find or mutate another user's post", async method => {
  read.maybeSingle.mockResolvedValue({data:null,error:null});
  expect((await run(method)).status).toHaveBeenCalledWith(404);
  expect(read.eq).toHaveBeenCalledWith("user_id","alice");
  expect(from).toHaveBeenCalledTimes(1);
});

test.each(["PATCH","DELETE"])("%s rejects stale calendar timestamps", async method => {
  const res=await run(method,{expectedScheduledAt:"2999-01-01T07:00:00Z"});
  expect(res.status).toHaveBeenCalledWith(409);
  expect(from).toHaveBeenCalledTimes(1);
});

test.each(["publishing","published"])("neither move nor delete can change a %s post", async status => {
  read.maybeSingle.mockResolvedValue({data:{...post,status},error:null});
  for (const method of ["PATCH","DELETE"]) {
    from.mockReset().mockReturnValue(read);
    expect((await run(method)).status).toHaveBeenCalledWith(409);
    expect(mutation.update).not.toHaveBeenCalled();
    expect(mutation.delete).not.toHaveBeenCalled();
  }
});

test("failed posts cannot be moved as an implicit retry", async () => {
  read.maybeSingle.mockResolvedValue({data:{...post,status:"failed"},error:null});
  expect((await run()).status).toHaveBeenCalledWith(409);
  expect(mutation.update).not.toHaveBeenCalled();
});

test.each(["PATCH","DELETE"])("%s loses safely to a concurrent worker or another edit", async method => {
  mutation.maybeSingle.mockResolvedValue({data:null,error:null});
  expect((await run(method)).status).toHaveBeenCalledWith(409);
  expect(mutation.eq).toHaveBeenCalledWith("scheduled_at",oldTime);
});

test.each(["2000-01-01T08:00:00Z","invalid","",null])("rejects a past, missing or invalid move time: %s", async scheduledAt => {
  expect((await run("PATCH",{scheduledAt})).status).toHaveBeenCalledWith(400);
  expect(createAdminClient).not.toHaveBeenCalled();
});

test.each(["invalid",null,""])("rejects an invalid original timestamp: %s", async expectedScheduledAt => {
  expect((await run("DELETE",{expectedScheduledAt})).status).toHaveBeenCalledWith(400);
  expect(createAdminClient).not.toHaveBeenCalled();
});

test.each(["bad-id",[id],null])("rejects malformed schedule IDs: %s", async scheduleId => {
  expect((await run("DELETE",{},scheduleId)).status).toHaveBeenCalledWith(400);
  expect(createAdminClient).not.toHaveBeenCalled();
});

test("a disconnected original account cannot be silently switched during a move", async () => {
  jest.mocked(getScheduledInstagramAccount).mockResolvedValue(null);
  expect((await run()).status).toHaveBeenCalledWith(409);
  expect(mutation.update).not.toHaveBeenCalled();
});

test.each(["PATCH","DELETE"])("anonymous and rate-limited %s requests do not access posts", async method => {
  jest.mocked(requireAuth).mockResolvedValueOnce(null);
  await run(method);
  expect(createAdminClient).not.toHaveBeenCalled();
  jest.mocked(checkApiRateLimit).mockResolvedValue(false);
  await run(method);
  expect(createAdminClient).not.toHaveBeenCalled();
});

test("a denied Pro check cannot move schedules", async () => {
  jest.mocked(requireInstagramPro).mockResolvedValue(false);
  await run();
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(checkApiRateLimit).not.toHaveBeenCalled();
});

test.each(["PATCH","DELETE"])("%s sanitizes database failures", async method => {
  mutation.maybeSingle.mockResolvedValue({data:null,error:{message:"private database details"}});
  const res=await run(method);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain("private database details");
});

test("unsupported methods disclose only allowed methods", async () => {
  const res=await run("POST");
  expect(res.status).toHaveBeenCalledWith(405);
  expect(res.setHeader).toHaveBeenCalledWith("Allow","PATCH, DELETE");
  expect(requireAuth).not.toHaveBeenCalled();
});

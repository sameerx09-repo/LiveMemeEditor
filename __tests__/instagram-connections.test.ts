import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { disconnectInstagramAccount, getDefaultInstagramAccount, getScheduledInstagramAccount, saveInstagramAccount } from "@/lib/instagram";

jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn() }));
const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
const rpc = jest.fn(); const from = jest.fn();
const account = { id: "original-account", user_id: "alice", ig_user_id: "ig-alice", username: "alice-ig", access_token: "fixture-token", page_id: null };
let query: { select: jest.Mock; eq: jest.Mock; neq: jest.Mock; order: jest.Mock; limit: jest.Mock; maybeSingle: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role";
  query = { select: jest.fn(), eq: jest.fn(), neq: jest.fn(), order: jest.fn(), limit: jest.fn(), maybeSingle: jest.fn() };
  for (const method of [query.select, query.eq, query.neq, query.order, query.limit]) method.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: account, error: null });
  from.mockReturnValue(query); rpc.mockResolvedValue({ error: null });
  jest.mocked(createClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createClient>);
});
afterEach(() => {
  if (env.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
  if (env.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.key;
});

test("default selection excludes disconnected tokens and chooses the most recently connected account", async () => {
  expect(await getDefaultInstagramAccount("alice")).toEqual(expect.objectContaining({ igUserId: "ig-alice" }));
  expect(query.eq).toHaveBeenCalledWith("user_id", "alice");
  expect(query.eq).toHaveBeenCalledWith("provider", "instagram");
  expect(query.neq).toHaveBeenCalledWith("access_token", "");
  expect(query.order).toHaveBeenCalledWith("updated_at", { ascending: false });
});

test.each([null, { ...account, access_token: "" }])("disconnected rows never yield publishing credentials", async data => {
  query.maybeSingle.mockResolvedValue({ data, error: null });
  expect(await getDefaultInstagramAccount("alice")).toBeNull();
  expect(await getScheduledInstagramAccount("alice", "original-account")).toBeNull();
});

test("scheduled lookup is bound to the original account ID and owner", async () => {
  await getScheduledInstagramAccount("alice", "original-account");
  expect(query.eq).toHaveBeenCalledWith("id", "original-account");
  expect(query.eq).toHaveBeenCalledWith("user_id", "alice");
  expect(query.eq).toHaveBeenCalledWith("provider", "instagram");
  expect(query.order).not.toHaveBeenCalled();
});

test("disconnect is a single atomic owner-scoped RPC, not a cascading delete", async () => {
  await disconnectInstagramAccount("alice");
  expect(rpc).toHaveBeenCalledWith("disconnect_instagram_account", { p_user_id: "alice" });
  expect(from).not.toHaveBeenCalled();
});

test("OAuth saving atomically replaces active accounts without deleting history", async () => {
  await saveInstagramAccount("alice", { igUserId: "ig-new", username: "new-ig", accessToken: "new-fixture-token" });
  expect(rpc).toHaveBeenCalledWith("connect_instagram_account", { p_user_id: "alice", p_ig_user_id: "ig-new", p_username: "new-ig", p_access_token: "new-fixture-token", p_page_id: null });
  expect(from).not.toHaveBeenCalled();
});

test("an unavailable connection RPC fails closed with sanitized setup guidance", async () => {
  rpc.mockResolvedValue({ error: { message: "secret token" } });
  await expect(disconnectInstagramAccount("alice")).rejects.toThrow("database setup");
  await expect(saveInstagramAccount("alice", { igUserId: "ig", username: "name", accessToken: "fixture" })).rejects.toThrow("database setup");
});

test("the SQL migration is transactional, service-only, and retains published history", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/instagram-connections.sql"), "utf8");
  expect(sql).toMatch(/begin;[\s\S]*commit;/);
  expect(sql.match(/security definer set search_path = ''/g)).toHaveLength(2);
  expect(sql.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
  expect(sql.match(/set access_token = ''/g)).toHaveLength(2);
  expect(sql.match(/user_id = p_user_id and status = 'scheduled'/g)).toHaveLength(2);
  expect(sql).not.toMatch(/delete\s+from|truncate|drop\s+table/i);
  expect(sql.match(/from public, anon, authenticated;/g)).toHaveLength(2);
  expect(sql.match(/to service_role;/g)).toHaveLength(2);
  expect(sql).toContain("ig_user_id <> p_ig_user_id");
});

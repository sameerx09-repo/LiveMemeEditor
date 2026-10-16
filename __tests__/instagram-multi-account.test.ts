import { destinationIds,manualHandles,rememberedDestinations } from "@/lib/instagram-destinations";
import { createInstagramBatch,selectedInstagramAccounts } from "@/lib/instagram-batch";
import { createAdminClient,getScheduledInstagramAccount } from "@/lib/instagram";
import fs from "node:fs";
import path from "node:path";
jest.mock("@/lib/instagram",()=>({createAdminClient:jest.fn(),getScheduledInstagramAccount:jest.fn()}));
const ids=[1,2,3,4].map(i=>`11111111-1111-4111-8111-00000000000${i}`);
const accounts=ids.slice(0,3).map((id,i)=>({id,userId:"alice",igUserId:`ig-${i}`,username:`account${i}`,accessToken:`private-${i}`}));
const from=jest.fn();
beforeEach(()=>{jest.resetAllMocks();jest.mocked(createAdminClient).mockReturnValue({from} as unknown as ReturnType<typeof createAdminClient>);
  jest.mocked(getScheduledInstagramAccount).mockImplementation(async(owner,id)=>accounts.find(account=>account.id===id && account.userId===owner)||null);
});
test.each([[],ids,[ids[0],ids[0]],["bad"],null])("rejects invalid destination set %s",value=>{expect(()=>destinationIds(value)).toThrow();});
test("accepts one to three distinct owned destinations",async()=>{
  expect(await selectedInstagramAccounts("alice",ids.slice(0,3))).toEqual(accounts);
  for(const id of ids.slice(0,3))expect(getScheduledInstagramAccount).toHaveBeenCalledWith("alice",id);
});
test("one unavailable or foreign destination rejects the entire selection",async()=>{
  await expect(selectedInstagramAccounts("bob",ids.slice(0,2))).rejects.toThrow("disconnected or unavailable");
  expect(from).not.toHaveBeenCalled();
});
test("manual handles normalize and reject duplicates or more than three",()=>{
  expect(manualHandles(["@Account_1","account.2"])).toEqual(["account_1","account.2"]);
  for(const value of [["one","ONE"],["a","b","c","d"],["https://evil.test"],[]])expect(()=>manualHandles(value)).toThrow();
});
test("without browser storage, the default is the first account",()=>{expect(rememberedDestinations("alice",accounts)).toEqual([ids[0]]);});
const input=()=>({userId:"alice",groupId:ids[3],accounts,mediaReference:"owned-media",caption:"Caption",name:"Clip",scheduledAt:"2999-01-01T00:00:00Z",immediate:false});
test("creates all destination jobs in one atomic insert sharing the same video",async()=>{
  const select=jest.fn().mockResolvedValue({data:accounts.map(account=>({social_account_id:account.id,status:"scheduled"})),error:null});
  const insert=jest.fn((_rows: unknown)=>({select}));from.mockReturnValue({insert});
  const result=await createInstagramBatch(input());expect(result.created).toBe(true);expect(insert).toHaveBeenCalledTimes(1);
  expect(insert.mock.calls[0][0]).toEqual(accounts.map(account=>expect.objectContaining({user_id:"alice",social_account_id:account.id,group_id:ids[3],media_url:"owned-media",status:"scheduled"})));
});
test("an identical repeated request returns saved jobs without creating new publications",async()=>{
  const posts=accounts.map(account=>({social_account_id:account.id,caption:"Caption",media_url:"owned-media",scheduled_at:"2999-01-01T00:00:00Z",delivery_kind:"scheduled",status:"published"}));
  const existing={select:jest.fn(),eq:jest.fn()};existing.select.mockReturnValue(existing);
  existing.eq.mockReturnValueOnce(existing).mockResolvedValueOnce({data:posts,error:null});
  from.mockReturnValueOnce({insert:()=>({select:async()=>({error:{code:"23505"}})})}).mockReturnValueOnce(existing);
  const result=await createInstagramBatch(input());expect(result.created).toBe(false);expect(result.posts).toEqual(posts);
  expect(existing.eq).toHaveBeenCalledWith("user_id","alice");expect(existing.eq).toHaveBeenCalledWith("group_id",ids[3]);
});
test("a conflicting request ID cannot redirect an existing group to different accounts",async()=>{
  const existing={select:jest.fn(),eq:jest.fn()};existing.select.mockReturnValue(existing);existing.eq.mockReturnValueOnce(existing).mockResolvedValueOnce({data:[],error:null});
  from.mockReturnValueOnce({insert:()=>({select:async()=>({error:{code:"23505"}})})}).mockReturnValueOnce(existing);
  await expect(createInstagramBatch(input())).rejects.toThrow("different details");
});
test("new batch writes fail closed if migration is missing",async()=>{
  from.mockReturnValue({insert:()=>({select:async()=>({error:{code:"42703"}})})});
  await expect(createInstagramBatch(input())).rejects.toEqual({code:"42703"});expect(from).toHaveBeenCalledTimes(1);
});
test("connection migration enforces a serialized cap and only disconnects the selected target",()=>{
  const sql=fs.readFileSync(path.join(process.cwd(),"supabase/instagram-multi-account.sql"),"utf8");
  expect(sql).toContain("pg_advisory_xact_lock");expect(sql).toContain(">= 3");
  const connect=sql.split("create or replace function public.connect_instagram_account_multi")[1].split("end $$;")[0];
  expect(connect).not.toContain("set access_token=''");expect(connect).not.toContain("update public.instagram_posts");
  expect(sql).toContain("social_account_id=p_account_id and status='scheduled'");
  expect(sql).toContain("public.instagram_multi_account_ready()");
  expect(sql).toContain("on public.instagram_posts(user_id,group_id,social_account_id)");
  expect(sql).not.toMatch(/delete from|truncate/i);
});

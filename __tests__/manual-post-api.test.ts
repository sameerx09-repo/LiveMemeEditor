import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/manual-posts/[id]";
import createHandler from "@/pages/api/manual-posts/index";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { createAdminClient } from "@/lib/instagram";
import { manualReminderConfig } from "@/lib/manual-posts";
import { createScheduledMediaReference } from "@/lib/instagram-scheduled-media";
jest.mock("@/lib/supabase-server",()=>({requireAuth:jest.fn()}));
jest.mock("@/lib/membership-server",()=>({requireInstagramPro:jest.fn()}));
jest.mock("@/lib/api-rate-limit",()=>({checkApiRateLimit:jest.fn()}));
jest.mock("@/lib/instagram",()=>({createAdminClient:jest.fn(),getRequestBaseUrl:()=>"https://app.test"}));
jest.mock("@/lib/instagram-scheduled-media",()=>({createScheduledMediaReference:jest.fn(()=>"private-reference"),refreshScheduledMediaUrl:()=>"fresh-media"}));
jest.mock("@/lib/manual-posts",()=>({...jest.requireActual("@/lib/manual-posts"),manualReminderConfig:jest.fn()}));
const id="11111111-1111-4111-8111-111111111111",time="2999-01-01T00:00:00Z";
const from=jest.fn();
function query(data: unknown) {
  const q={select:jest.fn(),eq:jest.fn(),update:jest.fn(),delete:jest.fn(),insert:jest.fn(),order:jest.fn(),limit:jest.fn(),single:jest.fn(),maybeSingle:jest.fn()};
  for(const key of ["select","eq","update","delete","insert","order"] as const) q[key].mockReturnValue(q);
  q.maybeSingle.mockResolvedValue({data,error:null});q.single.mockResolvedValue({data,error:null});q.limit.mockResolvedValue({data:[],error:null});return q;
}
let read: ReturnType<typeof query>,write: ReturnType<typeof query>;
let account: jest.Mock;
beforeEach(()=>{
  jest.clearAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({id:"alice",email:"alice@test.example"});
  jest.mocked(requireInstagramPro).mockResolvedValue(true);jest.mocked(checkApiRateLimit).mockResolvedValue(true);
  jest.mocked(manualReminderConfig).mockReturnValue({enabled:true,origin:"https://app.test",cutoff:"2020-01-01T00:00:00Z",message:"enabled"});
  read=query({id,name:"Clip",caption:"Caption",media_url:"private",scheduled_at:time,status:"scheduled"});write=query({id,status:"scheduled",scheduled_at:time});
  from.mockReset().mockReturnValueOnce(read).mockReturnValue(write);
  account=jest.fn().mockResolvedValue({data:{user:{email:"alice@test.example",email_confirmed_at:"2020-01-01"}},error:null});
  jest.mocked(createAdminClient).mockReturnValue({from,auth:{admin:{getUserById:account}}} as unknown as ReturnType<typeof createAdminClient>);
});
async function run(method="GET",body:object={},create=false) {
  const res={status:jest.fn(),json:jest.fn(),end:jest.fn(),setHeader:jest.fn()};res.status.mockReturnValue(res);
  await (create?createHandler:handler)({method,headers:{},query:{id},body} as unknown as NextApiRequest,res as unknown as NextApiResponse);return res;
}
test("handoff reads are owner scoped and expose fresh media, not internal references",async()=>{
  const res=await run();expect(read.eq).toHaveBeenCalledWith("user_id","alice");
  expect(res.json).toHaveBeenCalledWith({post:expect.objectContaining({preview_url:"fresh-media"})});
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('"media_url"');
});
test("another user's post is not readable",async()=>{
  read.maybeSingle.mockResolvedValue({data:null,error:null});expect((await run()).status).toHaveBeenCalledWith(404);
});
test("no request is processed without auth",async()=>{
  jest.mocked(requireAuth).mockResolvedValue(null);await run();expect(from).not.toHaveBeenCalled();
});
test.each(["PATCH","DELETE"])("%s rejects a stale edit",async method=>{
  expect((await run(method,{expectedScheduledAt:"2000-01-01"})).status).toHaveBeenCalledWith(409);expect(from).toHaveBeenCalledTimes(1);
});
test.each(["notifying","completed"])("cannot delete a %s post",async status=>{
  read.maybeSingle.mockResolvedValue({data:{id,status,scheduled_at:time},error:null});
  expect((await run("DELETE",{expectedScheduledAt:time})).status).toHaveBeenCalledWith(409);expect(write.delete).not.toHaveBeenCalled();
});
test("deletion remains available after downgrading, and uses conditional ownership",async()=>{
  expect((await run("DELETE",{expectedScheduledAt:time})).status).toHaveBeenCalledWith(200);
  expect(requireInstagramPro).not.toHaveBeenCalled();expect(write.eq).toHaveBeenCalledWith("status","scheduled");expect(write.eq).toHaveBeenCalledWith("user_id","alice");
});
test("future posts cannot be marked done",async()=>{
  expect((await run("PATCH",{action:"complete",expectedScheduledAt:time})).status).toHaveBeenCalledWith(409);
});
test("explicit completion means completed, never published",async()=>{
  read.maybeSingle.mockResolvedValue({data:{id,status:"awaiting_manual",scheduled_at:"2000-01-01T00:00:00Z"},error:null});
  await run("PATCH",{action:"complete",expectedScheduledAt:"2000-01-01T00:00:00Z"});
  expect(write.update).toHaveBeenCalledWith(expect.objectContaining({status:"completed"}));expect(write.update).not.toHaveBeenCalledWith(expect.objectContaining({status:"published"}));
});
test("moving resets reminder delivery state, with compare-and-set",async()=>{
  await run("PATCH",{expectedScheduledAt:time,scheduledAt:"2999-01-02T00:00:00Z"});
  expect(write.update).toHaveBeenCalledWith(expect.objectContaining({attempts:0,email_sent_at:null,status:"scheduled"}));
  expect(write.eq).toHaveBeenCalledWith("scheduled_at",time);
});
const valid={emailReminder:true,name:"Clip",mediaUrl:"valid-media",caption:"Caption",scheduledAt:time,audioUrl:""};
test("creation uses current confirmed email and owner-validated media without an Instagram connection",async()=>{
  from.mockReset().mockReturnValue(write);const res=await run("POST",{...valid,userId:"bob",recipient:"attacker@example.test"},true);
  expect(res.status).toHaveBeenCalledWith(200);expect(account).toHaveBeenCalledWith("alice");
  expect(write.insert).toHaveBeenCalledWith(expect.objectContaining({user_id:"alice",media_url:"private-reference"}));
  expect(createScheduledMediaReference).toHaveBeenCalledWith("valid-media","alice","https://app.test");
});
test("email consent and confirmed email are required",async()=>{
  expect((await run("POST",{...valid,emailReminder:false},true)).status).toHaveBeenCalledWith(400);
  account.mockResolvedValue({data:{user:{email:"alice@test.example"}},error:null});
  expect((await run("POST",valid,true)).status).toHaveBeenCalledWith(409);
});
test("creation rejects past scheduling and unsafe audio",async()=>{
  expect((await run("POST",{...valid,scheduledAt:"2000-01-01"},true)).status).toHaveBeenCalledWith(400);
  expect((await run("POST",{...valid,audioUrl:"https://evil.test"},true)).status).toHaveBeenCalledWith(400);
});
test("disabled reminders cannot accept new jobs",async()=>{
  jest.mocked(manualReminderConfig).mockReturnValue({enabled:false,origin:"",cutoff:"",message:"off"});
  expect((await run("POST",valid,true)).status).toHaveBeenCalledWith(503);
});
test("Free accounts cannot create or reschedule manual reminders",async()=>{
  jest.mocked(requireInstagramPro).mockResolvedValue(false);
  await run("POST",valid,true);expect(read.insert).not.toHaveBeenCalled();expect(write.insert).not.toHaveBeenCalled();
  await run("PATCH",{expectedScheduledAt:time,scheduledAt:"2999-01-02T00:00:00Z"});expect(write.update).not.toHaveBeenCalled();
});
test("a concurrent reminder claim defeats stale edits",async()=>{
  write.maybeSingle.mockResolvedValue({data:null,error:null});
  expect((await run("PATCH",{expectedScheduledAt:time,scheduledAt:"2999-01-02T00:00:00Z"})).status).toHaveBeenCalledWith(409);
});

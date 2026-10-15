import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/manual-posts/run-due";
import { createAdminClient } from "@/lib/instagram";
import { manualReminderConfig } from "@/lib/manual-posts";
import { sendPostingReminder } from "@/lib/reminder-email";
jest.mock("@/lib/instagram",()=>({createAdminClient:jest.fn()}));
jest.mock("@/lib/manual-posts",()=>({manualReminderConfig:jest.fn()}));
jest.mock("@/lib/reminder-email",()=>({sendPostingReminder:jest.fn()}));
const post={id:"post-one",user_id:"alice",lease_id:"lease-one",attempts:1,scheduled_at:"2026-10-15T05:00:00Z"};
const rpc=jest.fn(),from=jest.fn(),getUser=jest.fn(),update=jest.fn(),eq=jest.fn();
const originalSecret=process.env.INSTAGRAM_CRON_SECRET;
beforeEach(()=>{
  jest.resetAllMocks();process.env.INSTAGRAM_CRON_SECRET="fixture";
  jest.mocked(manualReminderConfig).mockReturnValue({enabled:true,origin:"https://app.test",cutoff:"2020-01-01T00:00:00Z",message:"enabled"});
  rpc.mockResolvedValue({data:[post],error:null});
  getUser.mockResolvedValue({data:{user:{id:"alice",email:"alice@example.test",email_confirmed_at:"2020-01-01",app_metadata:{plan:"pro"}}},error:null});
  const result={eq,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};
  eq.mockReturnValue(result);update.mockReturnValue(result);from.mockReturnValue({update});
  jest.mocked(sendPostingReminder).mockResolvedValue("receipt");
  jest.mocked(createAdminClient).mockReturnValue({rpc,from,auth:{admin:{getUserById:getUser}}} as unknown as ReturnType<typeof createAdminClient>);
});
afterEach(()=>{if(originalSecret===undefined)delete process.env.INSTAGRAM_CRON_SECRET;else process.env.INSTAGRAM_CRON_SECRET=originalSecret;});
async function run(auth="Bearer fixture",method="POST") {
  const res={status:jest.fn(),json:jest.fn(),end:jest.fn(),setHeader:jest.fn()};res.status.mockReturnValue(res);
  await handler({method,headers:{authorization:auth}} as NextApiRequest,res as unknown as NextApiResponse);return res;
}
test("worker requires POST, secret and explicit enabled configuration",async()=>{
  expect((await run("wrong")).status).toHaveBeenCalledWith(401);
  expect((await run("Bearer fixture","GET")).status).toHaveBeenCalledWith(405);
  jest.mocked(manualReminderConfig).mockReturnValue({enabled:false,origin:"",cutoff:"",message:"off"});
  expect((await run()).status).toHaveBeenCalledWith(503);expect(rpc).not.toHaveBeenCalled();expect(sendPostingReminder).not.toHaveBeenCalled();
});
test("claims atomically, emails current verified owner and never marks published",async()=>{
  const res=await run();expect(rpc).toHaveBeenCalledWith("claim_manual_reminders",{p_not_before:"2020-01-01T00:00:00Z"});
  expect(sendPostingReminder).toHaveBeenCalledWith(post,"alice@example.test");
  expect(update).toHaveBeenCalledWith(expect.objectContaining({status:"awaiting_manual",email_sent_at:expect.any(String)}));
  expect(eq).toHaveBeenCalledWith("lease_id","lease-one");expect(res.json).toHaveBeenCalledWith({ok:true,sent:1,claimed:1});
});
test("a second worker with no claims sends nothing",async()=>{
  rpc.mockResolvedValue({data:[],error:null});await run();expect(sendPostingReminder).not.toHaveBeenCalled();
});
test.each(["free","unconfirmed"])("%s users do not receive reminders",async kind=>{
  getUser.mockResolvedValue({data:{user:{email:"alice@example.test",email_confirmed_at:kind==="unconfirmed"?null:"2020",app_metadata:{plan:kind==="free"?"free":"pro"}}},error:null});
  await run();expect(sendPostingReminder).not.toHaveBeenCalled();expect(update).toHaveBeenCalledWith(expect.objectContaining({status:"failed"}));
});
test.each([1,3])("provider failure on attempt %s uses bounded retry state",async attempts=>{
  rpc.mockResolvedValue({data:[{...post,attempts}],error:null});jest.mocked(sendPostingReminder).mockRejectedValue(new Error("provider failed"));
  await run();expect(update).toHaveBeenCalledWith(expect.objectContaining({status:attempts===3?"failed":"scheduled",next_attempt_at:expect.any(String)}));
});
test("accepted email plus failed DB save keeps the lease for idempotent recovery",async()=>{
  eq.mockImplementation(()=>({eq,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:new Error("database down")}).then(resolve)}));
  await run();expect(update).toHaveBeenCalledTimes(1);expect(sendPostingReminder).toHaveBeenCalledTimes(1);
});

import type { NextApiRequest,NextApiResponse } from "next";
import handler from "@/pages/api/instagram/publish";
import { createInstagramBatch,selectedInstagramAccounts } from "@/lib/instagram-batch";
import { createAdminClient,getScheduledInstagramAccount,publishInstagramMedia } from "@/lib/instagram";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
jest.mock("@/lib/supabase-server",()=>({requireAuth:jest.fn()}));
jest.mock("@/lib/membership-server",()=>({requireInstagramPro:jest.fn()}));
jest.mock("@/lib/api-rate-limit",()=>({checkApiRateLimit:async()=>true}));
jest.mock("@/lib/instagram-batch",()=>({createInstagramBatch:jest.fn(),selectedInstagramAccounts:jest.fn()}));
jest.mock("@/lib/instagram-scheduled-media",()=>({createScheduledMediaReference:()=>"owned-media"}));
jest.mock("@/lib/instagram",()=>({createAdminClient:jest.fn(),getScheduledInstagramAccount:jest.fn(),publishInstagramMedia:jest.fn(),getRequestBaseUrl:()=>"https://app.test"}));
const accounts=[1,2,3].map(i=>({id:`account-${i}`,userId:"alice",igUserId:`ig-${i}`,username:`account${i}`,accessToken:`private-${i}`}));
const jobs=()=>accounts.map((account,i)=>({id:`job-${i}`,social_account_id:account.id,status:"publishing",error:null,instagram_media_id:null,scheduled_at:"2026-10-16T00:00:00Z",group_id:"group"}));
const update=jest.fn(),eq=jest.fn();
beforeEach(()=>{
  jest.resetAllMocks();jest.mocked(requireAuth).mockResolvedValue({id:"alice",email:""});jest.mocked(requireInstagramPro).mockResolvedValue(true);
  jest.mocked(selectedInstagramAccounts).mockResolvedValue(accounts);jest.mocked(createInstagramBatch).mockResolvedValue({posts:jobs(),created:true});
  jest.mocked(getScheduledInstagramAccount).mockImplementation(async(_owner,id)=>accounts.find(account=>account.id===id)||null);
  jest.mocked(publishInstagramMedia).mockImplementation(async input=>{await input.onContainerCreated?.(`container-${input.igUserId}`);return {creationId:`container-${input.igUserId}`,mediaId:`media-${input.igUserId}`};});
  const q={eq,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};eq.mockReturnValue(q);update.mockReturnValue(q);
  jest.mocked(createAdminClient).mockReturnValue({from:()=>({update})} as unknown as ReturnType<typeof createAdminClient>);
});
async function run(){const res={status:jest.fn(),json:jest.fn(),end:jest.fn(),setHeader:jest.fn()};res.status.mockReturnValue(res);
  await handler({method:"POST",headers:{},body:{mediaUrl:"signed-media",caption:"Caption",accountIds:accounts.map(account=>account.id),requestId:"group"}} as unknown as NextApiRequest,res as unknown as NextApiResponse);return res;}
test("publishes independently with the correct token and saves each container before publication",async()=>{
  const res=await run();expect(publishInstagramMedia).toHaveBeenCalledTimes(3);
  for(const account of accounts)expect(publishInstagramMedia).toHaveBeenCalledWith(expect.objectContaining({accessToken:account.accessToken,igUserId:account.igUserId,mediaUrl:"signed-media"}));
  expect(update).toHaveBeenCalledWith(expect.objectContaining({instagram_creation_id:"container-ig-1"}));
  expect(res.json).toHaveBeenCalledWith({ok:true,results:expect.arrayContaining([expect.objectContaining({username:"account1",status:"published"})])});
  expect(JSON.stringify(res.json.mock.calls)).not.toContain("private-");
});
test("one failed destination does not fail or retry successful destinations",async()=>{
  jest.mocked(publishInstagramMedia).mockImplementation(async input=>{if(input.igUserId==="ig-2")throw new Error("Processing failed");return {creationId:"container",mediaId:`media-${input.igUserId}`};});
  const res=await run();expect(publishInstagramMedia).toHaveBeenCalledTimes(3);
  expect(res.json).toHaveBeenCalledWith({ok:false,results:expect.arrayContaining([expect.objectContaining({username:"account2",status:"failed"}),expect.objectContaining({username:"account1",status:"published"}),expect.objectContaining({username:"account3",status:"published"})])});
});
test("repeated requests return persisted results and never call Meta again",async()=>{
  jest.mocked(createInstagramBatch).mockResolvedValue({posts:jobs().map(post=>({...post,status:"published"})),created:false});
  await run();expect(publishInstagramMedia).not.toHaveBeenCalled();
});
test("invalid destinations do not create or publish any jobs",async()=>{
  jest.mocked(selectedInstagramAccounts).mockRejectedValue(new Error("Not owned"));
  expect((await run()).status).toHaveBeenCalledWith(409);expect(createInstagramBatch).not.toHaveBeenCalled();expect(publishInstagramMedia).not.toHaveBeenCalled();
});
test("membership is checked before multi-account work",async()=>{
  jest.mocked(requireInstagramPro).mockResolvedValue(false);await run();expect(selectedInstagramAccounts).not.toHaveBeenCalled();
});
test("a destination disconnected just before publication is never redirected",async()=>{
  jest.mocked(getScheduledInstagramAccount).mockImplementation(async(_owner,id)=>id===accounts[1].id?null:accounts.find(account=>account.id===id)||null);
  await run();expect(publishInstagramMedia).toHaveBeenCalledTimes(2);expect(publishInstagramMedia).not.toHaveBeenCalledWith(expect.objectContaining({igUserId:"ig-2"}));
});

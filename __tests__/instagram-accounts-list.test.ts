import handler from "@/pages/api/instagram/accounts";
import { requireAuth } from "@/lib/supabase-server";
import { createAdminClient,listInstagramAccounts } from "@/lib/instagram";
import type { NextApiRequest,NextApiResponse } from "next";
jest.mock("@/lib/supabase-server",()=>({requireAuth:jest.fn()}));
jest.mock("@/lib/instagram",()=>({createAdminClient:jest.fn(),listInstagramAccounts:jest.fn()}));
const rpc=jest.fn();
beforeEach(()=>{
 jest.resetAllMocks();
 jest.mocked(requireAuth).mockResolvedValue({id:"alice"} as never);
 jest.mocked(createAdminClient).mockReturnValue({rpc} as never);
 jest.mocked(listInstagramAccounts).mockResolvedValue([{id:"one",username:"first",igUserId:"ig-one"}]);
 rpc.mockResolvedValue({data:true,error:null});
});
async function run(method="GET"){
 const res={status:jest.fn(),json:jest.fn(),end:jest.fn(),setHeader:jest.fn()};res.status.mockReturnValue(res);
 await handler({method} as NextApiRequest,res as unknown as NextApiResponse);return res;
}
test("returns only the authenticated owner's destinations and readiness",async()=>{
 const res=await run();expect(listInstagramAccounts).toHaveBeenCalledWith("alice");
 expect(res.json).toHaveBeenCalledWith({accounts:[{id:"one",username:"first",igUserId:"ig-one"}],limit:3,multiAccount:true});
 expect(res.setHeader).toHaveBeenCalledWith("Cache-Control","private, no-store");
});
test("missing readiness migration retains one-account mode",async()=>{
 rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});
 const res=await run();expect(res.json).toHaveBeenCalledWith(expect.objectContaining({limit:1,multiAccount:false}));
});
test("readiness failures do not silently choose a default account",async()=>{
 rpc.mockResolvedValue({data:null,error:{code:"network_error"}});
 expect((await run()).status).toHaveBeenCalledWith(503);
});
test("multiple destinations without readiness fail closed",async()=>{
 rpc.mockResolvedValue({data:false,error:null});
 jest.mocked(listInstagramAccounts).mockResolvedValue([{id:"one",username:"first",igUserId:"ig-one"},{id:"two",username:"second",igUserId:"ig-two"}]);
 expect((await run()).status).toHaveBeenCalledWith(503);
});
test("unauthenticated requests cannot list destinations",async()=>{
 jest.mocked(requireAuth).mockResolvedValue(null);await run();expect(listInstagramAccounts).not.toHaveBeenCalled();
});
test("other methods are rejected before querying",async()=>{
 expect((await run("POST")).status).toHaveBeenCalledWith(405);expect(rpc).not.toHaveBeenCalled();
});

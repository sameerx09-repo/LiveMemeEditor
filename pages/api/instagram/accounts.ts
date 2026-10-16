import type { NextApiRequest,NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { listInstagramAccounts,createAdminClient } from "@/lib/instagram";
export default async function handler(req:NextApiRequest,res:NextApiResponse) {
  res.setHeader("Cache-Control","private, no-store");
  if(req.method!=="GET") return res.status(405).end();
  const user=await requireAuth(req,res);if(!user)return;
  try {
    const ready=await createAdminClient().rpc("instagram_multi_account_ready");
    const accounts=await listInstagramAccounts(user.id);
    if((ready.error && !["PGRST202","42883"].includes(ready.error.code)) || (ready.data!==true && accounts.length>1))throw new Error("Account readiness unavailable");
    return res.status(200).json({accounts,limit:ready.data===true?3:1,multiAccount:ready.data===true});
  }
  catch {return res.status(503).json({error:"Could not load Instagram accounts"});}
}

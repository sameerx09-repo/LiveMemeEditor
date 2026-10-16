import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@/lib/supabase-server";
import { requireInstagramPro } from "@/lib/membership-server";
import { getDefaultInstagramAccount, publishInstagramMedia } from "@/lib/instagram";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { createScheduledMediaReference } from "@/lib/instagram-scheduled-media";
import { getRequestBaseUrl } from "@/lib/instagram";
import { createAdminClient,getScheduledInstagramAccount } from "@/lib/instagram";
import { createInstagramBatch,selectedInstagramAccounts } from "@/lib/instagram-batch";

export const config = { maxDuration: 300 };

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Instagram publish failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await requireAuth(req, res);
  if (!user) return;
  if (!await requireInstagramPro(user.id, res)) return;
  if (!await checkApiRateLimit(user.id, "publish", res)) return;
  res.setHeader("Cache-Control", "no-store");

  try {
    const { mediaUrl, caption, igUserId } = req.body || {};
    if (!mediaUrl || typeof mediaUrl !== "string") {
      return res.status(400).json({ error: "Missing mediaUrl" });
    }
    try { createScheduledMediaReference(mediaUrl, user.id, getRequestBaseUrl(req)); }
    catch { return res.status(400).json({ error: "Upload this account's clip again before publishing" }); }

    if(req.body.accountIds !== undefined) {
      let batch,accounts;
      try {
        if(typeof caption!=="string" || caption.length>2200)throw new Error("Caption must be at most 2200 characters");
        accounts=await selectedInstagramAccounts(user.id,req.body.accountIds);
        batch=await createInstagramBatch({userId:user.id,groupId:req.body.requestId,accounts,
          mediaReference:createScheduledMediaReference(mediaUrl,user.id,getRequestBaseUrl(req)),caption,
          name:typeof req.body.name==="string"?req.body.name:"Instagram reel",scheduledAt:new Date().toISOString(),immediate:true});
      } catch(error) {return res.status(409).json({error:error instanceof Error?error.message:"Invalid destinations"});}
      const admin=createAdminClient();
      if(batch.created) await Promise.all(batch.posts.map(async post=>{
        let published=false;
        try {
          const account=await getScheduledInstagramAccount(user.id,post.social_account_id);
          if(!account)throw new Error("Selected account disconnected before publishing");
          const result=await publishInstagramMedia({accessToken:account.accessToken,igUserId:account.igUserId,mediaUrl,caption,mediaType:"REELS",
            onContainerCreated:async creationId=>{const saved=await admin.from("instagram_posts").update({instagram_creation_id:creationId,updated_at:new Date().toISOString()}).eq("id",post.id).eq("user_id",user.id);if(saved.error)throw saved.error;}});
          published=true;
          const saved=await admin.from("instagram_posts").update({status:"published",instagram_media_id:result.mediaId,instagram_creation_id:result.creationId,
            published_at:new Date().toISOString(),updated_at:new Date().toISOString(),error:null}).eq("id",post.id).eq("user_id",user.id);
          if(saved.error)throw saved.error;
          post.status="published";post.instagram_media_id=result.mediaId;post.error=null;
        }catch(error){
          post.error=published?"Published on Instagram; saving confirmation failed. Do not repost.":errorMessage(error);
          if(!published){post.status="failed";try{await admin.from("instagram_posts").update({status:"failed",error:post.error,updated_at:new Date().toISOString()}).eq("id",post.id).eq("user_id",user.id);}catch { /* Never retry a publish because its result could not be saved. */ }}
        }
      }));
      return res.status(200).json({ok:batch.posts.every(post=>post.status==="published"),results:batch.posts.map(post=>({
        id:post.id,accountId:post.social_account_id,username:accounts.find(account=>account.id===post.social_account_id)?.username,
        status:post.status,error:post.error,mediaId:post.instagram_media_id,
      }))});
    }

    const account = await getDefaultInstagramAccount(user.id);
    if (!account) return res.status(409).json({ error: "Connect Instagram first" });
    if (typeof igUserId !== "string" || igUserId !== account.igUserId) {
      return res.status(409).json({ error: "Instagram connection changed. Refresh and confirm the account before posting." });
    }

    const published = await publishInstagramMedia({
      accessToken: account.accessToken,
      igUserId: account.igUserId,
      mediaUrl,
      caption: typeof caption === "string" ? caption : "",
      mediaType: "REELS",
    });

    res.status(200).json({ ok: true, ...published });
  } catch (err: unknown) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

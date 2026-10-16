import { createAdminClient,getScheduledInstagramAccount } from "./instagram";
import { destinationIds } from "./instagram-destinations";
import { validPostId } from "./manual-posts";
export async function selectedInstagramAccounts(userId:string,ids:unknown) {
  const accounts=await Promise.all(destinationIds(ids).map(id=>getScheduledInstagramAccount(userId,id)));
  if(accounts.some(account=>!account)) throw new Error("A selected Instagram account is disconnected or unavailable. Refresh destinations.");
  return accounts as NonNullable<(typeof accounts)[number]>[];
}
type BatchInput={userId:string;groupId:unknown;accounts:Awaited<ReturnType<typeof selectedInstagramAccounts>>;mediaReference:string;caption:string;name:string;scheduledAt:string;immediate:boolean};
export async function createInstagramBatch(input:BatchInput) {
  if(!validPostId(input.groupId)) throw new Error("Invalid posting request. Reopen the posting dialog.");
  const admin=createAdminClient();
  const {data,error}=await admin.from("instagram_posts").insert(input.accounts.map(account=>({
    user_id:input.userId,social_account_id:account.id,group_id:input.groupId,media_url:input.mediaReference,
    caption:input.caption,post_name:input.name.slice(0,200),scheduled_at:input.scheduledAt,
    status:input.immediate?"publishing":"scheduled",delivery_kind:input.immediate?"immediate":"scheduled",
  }))).select("id,social_account_id,scheduled_at,status,error,instagram_media_id,group_id");
  if(!error)return {posts:data || [],created:true};
  if(error.code!=="23505")throw error;
  const existing=await admin.from("instagram_posts").select("id,social_account_id,scheduled_at,status,error,instagram_media_id,group_id,caption,media_url,delivery_kind")
    .eq("user_id",input.userId).eq("group_id",input.groupId);
  if(existing.error)throw existing.error;
  const posts=existing.data || [];
  if(posts.length!==input.accounts.length || posts.some(post=>!input.accounts.some(account=>account.id===post.social_account_id) ||
      post.caption!==input.caption || post.media_url!==input.mediaReference || post.delivery_kind!==(input.immediate?"immediate":"scheduled") ||
      (!input.immediate && Date.parse(post.scheduled_at)!==Date.parse(input.scheduledAt)))) throw new Error("This posting request already exists with different details. Check the calendar before creating another.");
  return {posts,created:false};
}

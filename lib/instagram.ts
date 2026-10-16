import crypto from "crypto";
import { parseInstagramJson } from "./instagram-json";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import { createInstagramOAuthState } from "@/lib/instagram-oauth";
import { getInstagramStorageDownloadUrl } from "@/lib/instagram-storage";
import { InstagramProcessingTimeoutError, INSTAGRAM_PROCESSING_POLL_MS, INSTAGRAM_PROCESSING_WAIT_MS } from "@/lib/instagram-processing";
export { readInstagramOAuthState } from "@/lib/instagram-oauth";

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION || "v24.0";
type InstagramAuthMode = "instagram" | "facebook";

const FACEBOOK_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
].join(",");
const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
].join(",");

function getAuthMode(): InstagramAuthMode {
  return process.env.INSTAGRAM_AUTH_MODE === "facebook" ? "facebook" : "instagram";
}

function getGraphBase() {
  return getAuthMode() === "facebook"
    ? `https://graph.facebook.com/${GRAPH_VERSION}`
    : `https://graph.instagram.com/${GRAPH_VERSION}`;
}

function getOAuthBase() {
  return getAuthMode() === "facebook"
    ? `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`
    : "https://www.instagram.com/oauth/authorize";
}

function getDefaultScopes() {
  return getAuthMode() === "facebook" ? FACEBOOK_SCOPES : INSTAGRAM_SCOPES;
}

export type InstagramAccount = {
  id: string;
  userId: string;
  igUserId: string;
  username: string;
  accessToken: string;
  pageId?: string | null;
};

export type InstagramPublishInput = {
  accessToken: string;
  igUserId: string;
  mediaUrl: string;
  caption?: string;
  mediaType?: "REELS" | "VIDEO" | "IMAGE";
  onContainerCreated?: (creationId: string) => Promise<void>;
};

export function getInstagramRedirectUri(req?: { headers: { host?: string } }): string {
  if (process.env.INSTAGRAM_REDIRECT_URI) {
    const uri = new URL(process.env.INSTAGRAM_REDIRECT_URI);
    if (process.env.NODE_ENV === "production" && uri.protocol !== "https:") throw new Error("Instagram redirect must use HTTPS in production");
    return uri.toString();
  }
  if (process.env.NODE_ENV === "production") throw new Error("Missing INSTAGRAM_REDIRECT_URI");
  const host = req?.headers.host;
  if (!host) throw new Error("Missing INSTAGRAM_REDIRECT_URI");
  return `http://${host}/api/instagram/callback`;
}

export function buildInstagramAuthUrl(userId: string, redirectUri: string, browserToken: string): string {
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) throw new Error("Missing INSTAGRAM_APP_ID");
  const state = createInstagramOAuthState(userId, browserToken);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: process.env.INSTAGRAM_OAUTH_SCOPES || getDefaultScopes(),
    state,
  });

  if (getAuthMode() === "instagram") {
    params.set("enable_fb_login", "0");
    params.set("force_authentication", "1");
  }

  return `${getOAuthBase()}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{accessToken:string;igUserId?:string}> {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Missing Instagram app credentials");

  const mode = getAuthMode();
  const tokenRes = mode === "facebook"
    ? await fetch(`${getGraphBase()}/oauth/access_token?${new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      })}`)
    : await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code,
        }),
      });
  const payload = parseInstagramJson(await tokenRes.text());
  if (Array.isArray(payload.data) && (payload.access_token || payload.data.length !== 1)) {
    throw new Error("Instagram returned an ambiguous authorization result. Connect one account at a time.");
  }
  const tokenData = Array.isArray(payload.data) ? payload.data[0] : payload;
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error?.message || "Instagram token exchange failed");
  }
  const igUserId = mode === "instagram" ? tokenData.user_id : undefined;
  if (mode === "instagram" && (typeof igUserId !== "string" || !/^\d+$/.test(igUserId))) {
    throw new Error("Instagram did not return the authorized account ID. Connect Instagram again.");
  }

  const longLivedRes = mode === "facebook"
    ? await fetch(`${getGraphBase()}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: tokenData.access_token,
      })}`)
    : await fetch(`https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: appSecret,
        access_token: tokenData.access_token,
      })}`);
  const longLivedData = await longLivedRes.json();
  if (!longLivedRes.ok || !longLivedData.access_token) {
    return {accessToken:tokenData.access_token,igUserId};
  }

  return {accessToken:longLivedData.access_token,igUserId};
}

export async function discoverInstagramAccount(accessToken: string, authorizedUserId?: string) {
  if (getAuthMode() === "instagram") {
    if (typeof authorizedUserId !== "string" || !/^\d+$/.test(authorizedUserId)) {
      throw new Error("Missing authorized Instagram account ID. Connect Instagram again.");
    }
    const params = new URLSearchParams({
      access_token: accessToken,
      fields: "user_id,username",
    });
    const res = await fetch(`${getGraphBase()}/${authorizedUserId}?${params.toString()}`);
    const data = parseInstagramJson(await res.text());
    if (!res.ok) {
      console.error("[Instagram connect] account lookup rejected", {
        status:res.status,
        code:typeof data.error?.code==="number"?data.error.code:undefined,
        subcode:typeof data.error?.error_subcode==="number"?data.error.error_subcode:undefined,
      });
      throw new Error(data.error?.message || "Could not load Instagram account");
    }
    if (!data.user_id && !data.id) throw new Error("No Instagram professional account was found");

    return {
      igUserId: String(data.user_id || data.id),
      username: data.username || "Instagram",
    };
  }

  type PageWithInstagram = {
    id: string;
    name?: string;
    instagram_business_account?: {
      id: string;
      username?: string;
    };
  };

  const params = new URLSearchParams({
    access_token: accessToken,
    fields: "id,name,instagram_business_account{id,username}",
  });
  const res = await fetch(`${getGraphBase()}/me/accounts?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Could not list connected pages");

  const pages = (data.data ?? []) as PageWithInstagram[];
  const page = pages.find((p) => p.instagram_business_account?.id);
  if (!page) {
    throw new Error("No Instagram professional account was found on the connected Facebook pages");
  }
  const instagramAccount = page.instagram_business_account;
  if (!instagramAccount) throw new Error("No Instagram professional account was found");

  return {
    pageId: page.id,
    igUserId: instagramAccount.id,
    username: instagramAccount.username || page.name || "Instagram",
  };
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase service role configuration");
  return createClient(url, serviceRole);
}

export async function getDefaultInstagramAccount(userId: string): Promise<InstagramAccount | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("social_accounts")
    .select("id,user_id,ig_user_id,username,access_token,page_id")
    .eq("user_id", userId)
    .eq("provider", "instagram")
    .neq("access_token", "")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.access_token) return null;

  return {
    id: data.id,
    userId: data.user_id,
    igUserId: data.ig_user_id,
    username: data.username,
    accessToken: data.access_token,
    pageId: data.page_id,
  };
}

export async function saveInstagramAccount(userId: string, account: {
  accessToken: string;
  igUserId: string;
  username: string;
  pageId?: string;
}) {
  const admin = createAdminClient();
  const ready=await admin.rpc("instagram_multi_account_ready");
  const { error } = await admin.rpc(ready.data===true ? "connect_instagram_account_multi" : "connect_instagram_account", {
    p_user_id: userId,
    p_ig_user_id: account.igUserId,
    p_username: account.username,
    p_page_id: account.pageId ?? null,
    p_access_token: account.accessToken,
  });

  if (error?.message?.includes("Maximum three")) throw new Error("Three Instagram accounts are already connected. Disconnect one before adding another.");
  if (error) throw new Error("Could not save Instagram connection. Ask the administrator to check the Instagram connections database setup.");
}

export async function disconnectInstagramAccount(userId: string, accountId?: string) {
  const admin=createAdminClient();
  const targeted=!!accountId;
  if(accountId) {
    const ready=await admin.rpc("instagram_multi_account_ready");
    if(ready.data!==true)throw new Error("Apply the multi-account database migration before disconnecting a specific account");
  }
  const { error } = await admin.rpc(targeted ? "disconnect_instagram_account_target" : "disconnect_instagram_account", targeted ? {p_user_id:userId,p_account_id:accountId} : { p_user_id: userId });
  if (error) throw new Error("Could not disconnect Instagram. Please try again or ask the administrator to check the Instagram connections database setup.");
}

export async function listInstagramAccounts(userId: string) {
  const {data,error}=await createAdminClient().from("social_accounts").select("id,ig_user_id,username")
    .eq("user_id",userId).eq("provider","instagram").neq("access_token","").order("updated_at",{ascending:false});
  if(error) throw error;
  return (data || []).map(account=>({id:account.id,igUserId:account.ig_user_id,username:account.username}));
}

export async function getScheduledInstagramAccount(userId: string, accountId: string): Promise<InstagramAccount | null> {
  const { data, error } = await createAdminClient().from("social_accounts")
    .select("id,user_id,ig_user_id,username,access_token,page_id")
    .eq("id", accountId).eq("user_id", userId).eq("provider", "instagram").maybeSingle();

  if (error) throw error;
  if (!data?.access_token) return null;
  return { id: data.id, userId: data.user_id, igUserId: data.ig_user_id,
    username: data.username, accessToken: data.access_token, pageId: data.page_id };
}

export async function uploadInstagramMedia(userId: string, body: Buffer, contentType: string) {
  const r2 = getR2Client();
  if (!r2) throw new Error("R2 not configured");

  const ext = contentType.includes("mp4") ? "mp4" : contentType.includes("webm") ? "webm" : "bin";
  const key = `social/instagram/${userId}/${crypto.randomBytes(16).toString("hex")}.${ext}`;

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  return {
    key,
  };
}

export function getRequestBaseUrl(req: { headers: { host?: string; "x-forwarded-proto"?: string | string[] } }) {
  if (process.env.APP_URL) return new URL(process.env.APP_URL).origin;
  const host = req.headers.host;
  if (!host) throw new Error("Missing request host");
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return `${proto || "http"}://${host}`;
}

export function signInstagramMediaUrl(baseUrl: string, key: string) {
  const secret = process.env.INSTAGRAM_STATE_SECRET || process.env.INSTAGRAM_APP_SECRET;
  if (!secret) throw new Error("Missing INSTAGRAM_STATE_SECRET");

  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  const payload = `${key}.${expires}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${baseUrl.replace(/\/$/, "")}/api/instagram/media?${new URLSearchParams({
    key,
    expires: String(expires),
    sig,
  }).toString()}`;
}

export function verifyInstagramMediaSignature(key: string, expires: string, sig: string) {
  const secret = process.env.INSTAGRAM_STATE_SECRET || process.env.INSTAGRAM_APP_SECRET;
  if (!secret) return false;

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  if (!key.startsWith("social/instagram/")) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${key}.${expires}`).digest("base64url");
  const actualBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function publishInstagramMedia(input: InstagramPublishInput) {
  const reference = new URL(input.mediaUrl);
  const key = reference.searchParams.get("key");
  if (reference.pathname !== "/api/instagram/media" || !key ||
      !verifyInstagramMediaSignature(key, reference.searchParams.get("expires") || "", reference.searchParams.get("sig") || "")) {
    throw new Error("Upload the clip again before publishing");
  }
  const deliveryUrl = await getInstagramStorageDownloadUrl(key);
  const containerParams = new URLSearchParams({
    access_token: input.accessToken,
    caption: input.caption || "",
  });

  if (input.mediaType === "IMAGE") {
    containerParams.set("image_url", deliveryUrl);
  } else {
    containerParams.set("media_type", input.mediaType || "REELS");
    containerParams.set("video_url", deliveryUrl);
  }

  const graphBase = getGraphBase();
  const createRes = await fetch(`${graphBase}/${input.igUserId}/media`, {
    method: "POST",
    body: containerParams,
    signal: AbortSignal.timeout(15000),
  });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id) {
    throw new Error(createData.error?.message || "Instagram media container creation failed");
  }

  await input.onContainerCreated?.(String(createData.id));
  await waitForContainer(input.accessToken, createData.id);

  const publishRes = await fetch(`${graphBase}/${input.igUserId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({
      access_token: input.accessToken,
      creation_id: createData.id,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id) {
    throw new Error(publishData.error?.message || "Instagram publish failed");
  }

  return { creationId: createData.id as string, mediaId: publishData.id as string };
}

async function waitForContainer(accessToken: string, creationId: string) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: "status_code,status",
  });

  const deadline = Date.now() + INSTAGRAM_PROCESSING_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${getGraphBase()}/${creationId}?${params.toString()}`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))),
      });
      const transientResponse = res.status === 429 || res.status >= 500;
      const data = transientResponse ? {} : await res.json();
      if (!res.ok && !transientResponse) throw new Error(data.error?.message || "Could not check Instagram container status");
      if (res.ok && data.status_code === "FINISHED") return;
      if (res.ok && (data.status_code === "ERROR" || data.status_code === "EXPIRED")) {
        const detail = typeof data.status === "string" ? data.status.replace(/https?:\/\/\S+/g, "[media URL]").slice(0, 500) : "";
        throw new Error(`Instagram container ${creationId} processing ${String(data.status_code).toLowerCase()}${detail ? `: ${detail}` : ""}`);
      }
      if (res.ok && data.status_code === "PUBLISHED") throw new Error("This Instagram container is already published. Check Instagram before taking further action.");
    } catch (error) {
      // Only status GETs may be retried. Never repeat creation or media_publish POSTs.
      if (!(error instanceof TypeError) && !(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) throw error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(INSTAGRAM_PROCESSING_POLL_MS, remaining)));
  }

  throw new InstagramProcessingTimeoutError(creationId);
}

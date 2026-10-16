import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { Check, Copy, Download, ExternalLink, Share2 } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { manualPostLabel, validPostId, type ManualPost } from "@/lib/manual-posts";
import SchedulePreviewVideo from "@/components/Social/SchedulePreviewVideo";

type Post = Pick<ManualPost,"id"|"name"|"caption"|"audio_url"|"scheduled_at"|"status"|"error"|"email_sent_at"|"target_username"> & { preview_url: string };
const button = "inline-flex items-center justify-center gap-2 border border-[#555] rounded-md px-4 py-3 text-sm disabled:opacity-40";
export default function ManualPostPage() {
  const router = useRouter();
  const [post,setPost] = useState<Post | null>(null);
  const [prepared,setPrepared] = useState<{file:File;url:string;canShare:boolean} | null>(null);
  const file = prepared?.file;
  const fileUrl = prepared?.url;
  const canShare = prepared?.canShare;
  const ownedUrl = useRef("");
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [confirming,setConfirming] = useState(false);
  const [now,setNow] = useState(() => Date.now());
  const controller = useRef<AbortController | null>(null);
  const owner = useRef<string | null>(null);
  const redirect = () => void router.replace(`/login?returnTo=${encodeURIComponent(`/manual-post/${router.query.id}`)}`);
  async function request(init: RequestInit = {}) {
    const signal = controller.current?.signal;
    const {data:{session}} = await createClient().auth.getSession();
    if (signal?.aborted) throw new DOMException("Request cancelled","AbortError");
    if (!session || (owner.current && owner.current !== session.user.id)) { redirect(); throw new Error("Sign in to the account that scheduled this post"); }
    owner.current = session.user.id;
    const response = await fetch(`/api/manual-posts/${router.query.id}`, { ...init, cache: "no-store", signal,
      headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` } });
    if (response.status === 401) {redirect();throw new Error("Sign in again");}
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Post unavailable");
    return data;
  }
  useEffect(() => {
    if (!router.isReady) return;
    const current = new AbortController(); controller.current = current;
    const client = createClient();
    const {data:{subscription}} = client.auth.onAuthStateChange((_event,session) => {
      if (owner.current && session?.user.id !== owner.current) {
        current.abort();setPost(null);setPrepared(null);URL.revokeObjectURL(ownedUrl.current);ownedUrl.current="";setError("Account changed. Sign in again.");redirect();
      }
    });
    void (async () => {
      if (!validPostId(router.query.id)) throw new Error("Invalid post link");
      return request();
    })().then(data => {if (!current.signal.aborted) setPost(data.post);})
      .catch(e => {if (!current.signal.aborted) setError(e.message);})
      .finally(() => {if (!current.signal.aborted) setLoading(false);});
    return () => {current.abort();subscription.unsubscribe();URL.revokeObjectURL(ownedUrl.current);ownedUrl.current="";};
  },[router.isReady,router.query.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()),1000);
    const pause = () => {if (document.hidden) document.querySelector<HTMLVideoElement>('video[aria-label="Scheduled clip preview"]')?.pause();};
    document.addEventListener("visibilitychange",pause);
    return () => {window.clearInterval(timer);document.removeEventListener("visibilitychange",pause);};
  },[]);
  async function prepare() {
    if (busy) return;
    setBusy(true);setError("");setNotice("");
    try {
      const fresh = (await request()).post as Post;
      const signal = controller.current ? AbortSignal.any([controller.current.signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
      const response = await fetch(fresh.preview_url, {credentials:"omit",cache:"no-store",signal});
      if (!response.ok) throw new Error("Video unavailable. Try preparing it again.");
      const limit = 500*1024*1024;
      if (Number(response.headers.get("Content-Length")) > limit) throw new Error("Video is too large for this handoff");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Video download unavailable");
      const chunks: BlobPart[] = [];let size=0;
      while (true) {
        const {done,value} = await reader.read();if(done) break;
        size += value.byteLength;
        if(size>limit) {await reader.cancel();throw new Error("Video is too large for this handoff");}
        chunks.push(value as Uint8Array<ArrayBuffer>);
      }
      const blob = new Blob(chunks,{type:response.headers.get("Content-Type") || "video/mp4"});
      if (!blob.size || blob.size > 500*1024*1024) throw new Error("Video is empty or too large for this handoff");
      if (controller.current?.signal.aborted) return;
      const type = blob.type.split(";")[0];
      if (!["video/mp4","video/webm"].includes(type)) throw new Error("Unsupported video format");
      const nextFile = new File([blob],`instagram-reel.${type === "video/mp4" ? "mp4" : "webm"}`,{type});
      URL.revokeObjectURL(ownedUrl.current);ownedUrl.current=URL.createObjectURL(nextFile);
      let shareable=false;
      try {shareable=typeof navigator.share === "function" && !!navigator.canShare?.({files:[nextFile]});} catch { /* Download remains available. */ }
      setPost(fresh);setPrepared({file:nextFile,url:ownedUrl.current,canShare:shareable});
    } catch(e) {if (!controller.current?.signal.aborted) setError(e instanceof Error ? e.message : "Could not prepare video");}
    finally {setBusy(false);}
  }
  async function share() {
    if (!file || busy) return;
    document.querySelector<HTMLVideoElement>('video[aria-label="Scheduled clip preview"]')?.pause();
    setBusy(true);setNotice("");setError("");
    try {await navigator.share({files:[file]});setNotice("Video handed to the share sheet. Instagram publication is not confirmed.");}
    catch(e) {if (!(e instanceof Error && e.name === "AbortError")) setError("Sharing unavailable. Use Download video instead.");}
    finally {setBusy(false);}
  }
  async function copy() {
    try {await navigator.clipboard.writeText(post?.caption || "");setNotice("Caption copied");}
    catch {setError("Could not copy. Select the caption below instead.");}
  }
  async function complete() {
    if (!post || busy) return;
    setBusy(true);setError("");
    try {await request({method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"complete",expectedScheduledAt:post.scheduled_at})});
      setPost({...post,status:"completed"});setConfirming(false);setNotice("Marked done by you. Instagram publication has not been independently verified.");
    } catch(e) {setError(e instanceof Error ? e.message : "Could not update post");}
    finally {setBusy(false);}
  }
  return <><Head><title>Finish in Instagram | ClipMemeEditor</title><meta name="robots" content="noindex,nofollow"/></Head>
    <div className="min-h-screen bg-[#111] text-white px-4 py-5"><div className="max-w-xl mx-auto">
      <header className="flex items-center justify-between gap-4 pb-5 border-b border-[#333]"><Link href="/" className="font-bold text-sm">Clip<span className="text-[#ff6565]">MemeEditor</span></Link><Link href="/?workspace=schedule" className="text-xs text-[#bbb]">Calendar</Link></header>
      <main className="py-6 space-y-5"><h1 className="text-xl font-semibold">Finish in Instagram</h1>
        {loading && <p role="status" className="text-sm text-[#bbb]">Loading post...</p>}
        {error && <p role="alert" className="text-sm text-red-300 break-words">{error}</p>}
        {post && <>
          <div><h2 className="text-base break-words">{post.name}</h2><p className="text-xs text-[#bbb] mt-2">{new Date(post.scheduled_at).toLocaleString()} · {manualPostLabel(post.status)}</p></div>
          {post.target_username && <p className="text-sm text-[#78cfc8] break-all">Instagram destination: @{post.target_username}</p>}
          <SchedulePreviewVideo key={fileUrl || post.preview_url} src={fileUrl || post.preview_url}/>
          <div className="flex flex-wrap gap-3">
            {!file ? <button className={`${button} bg-[#a72c35]`} disabled={busy} onClick={() => void prepare()}><Download size={16}/>{busy ? "Preparing..." : "Prepare video"}</button> : <>
              {canShare && <button className={`${button} bg-[#a72c35]`} disabled={busy} onClick={() => void share()}><Share2 size={16}/>Share video</button>}
              {fileUrl && <a className={button} href={fileUrl} download={file.name}><Download size={16}/>Download video</a>}
            </>}
            <button className={button} disabled={!post.caption || busy} onClick={() => void copy()}><Copy size={16}/>Copy caption</button>
            {post.audio_url && <a className={button} href={post.audio_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Open audio</a>}
          </div>
          <label className="block text-xs text-[#bbb]">Caption<textarea readOnly rows={4} value={post.caption} className="block mt-2 w-full bg-[#1c1c1c] border border-[#444] rounded p-3 text-sm text-white"/></label>
          {post.error && <p className="text-xs text-amber-300">{post.error}</p>}
          <div className="pt-5 border-t border-[#333]">
            {post.status !== "completed" && <button disabled={busy || post.status === "notifying" || Date.parse(post.scheduled_at)>now} className={button} onClick={() => setConfirming(true)}><Check size={16}/>Mark as done</button>}
            {confirming && <div role="alertdialog" aria-label="Confirm manual posting" className="mt-4 space-y-3"><p className="text-sm">Have you finished publishing this Reel in Instagram?</p><div className="flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button><button className={button} disabled={busy} onClick={() => void complete()}>Yes, mark done</button></div></div>}
          </div>
          {notice && <p role="status" className="text-sm text-[#78cfc8]">{notice}</p>}
        </>}
      </main>
    </div></div>
  </>;
}

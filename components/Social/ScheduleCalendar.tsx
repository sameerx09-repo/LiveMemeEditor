import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarClock, Film, GripVertical, Play, RefreshCw, Trash2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase-browser";
import type { ClipHistoryItem } from "@/lib/types";
import { calendarMoveTime, calendarScheduleTime, isFutureSchedule } from "@/lib/calendar-time";
import { linkScheduledClip, listScheduledClips, unlinkScheduledClip, type ScheduledClipLink } from "@/lib/export-history";
import { uploadInstagramClip } from "@/lib/instagram-upload-client";
import { useInstagramAccess } from "@/lib/use-instagram-access";
import { INSTAGRAM_CONNECTION_CHANGED } from "@/lib/instagram-connection-events";
type Post = { id: string; caption: string; scheduled_at: string; status: string; preview_url?: string | null; error?: string };
const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
const control = "border border-[#444] rounded px-3 py-2 text-xs disabled:opacity-40";
export default function ScheduleCalendar() {
  const access = useInstagramAccess();
  const history = useStore(s => s.history);
  const clips = history.filter(c => c.exportUrl);
  const [date,setDate] = useState(() => local(new Date()).slice(0,10));
  const [now,setNow] = useState(() => Date.now());
  const [view,setView] = useState("60");
  const [posts,setPosts] = useState<Post[]>([]);
  const [scheduler,setScheduler] = useState<{enabled: boolean; message: string; notBefore?: string | null} | null>(null);
  const [selected,setSelected] = useState<ClipHistoryItem | null>(null);
  const [draft,setDraft] = useState<{clip: ClipHistoryItem; time: string} | null>(null);
  const [caption,setCaption] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [links,setLinks] = useState<ScheduledClipLink[]>([]);
  const [highlighted,setHighlighted] = useState<string | null>(null);
  const [preview,setPreview] = useState<Post | null>(null);
  const [editing,setEditing] = useState<{post: Post; time: string} | null>(null);
  const [deleting,setDeleting] = useState<Post | null>(null);
  const [draggingPost,setDraggingPost] = useState<string | null>(null);
  const [notice,setNotice] = useState("");
  const working = useRef(false);
  const loadRevision = useRef(0);
  const historyRef = useRef<HTMLElement>(null);
  async function request(url: string, init: RequestInit = {}) {
    const {data:{session}} = await createClient().auth.getSession();
    if (!session) throw new Error("Sign in to schedule posts");
    const res = await fetch(url,{...init,headers:{...init.headers,Authorization:`Bearer ${session.access_token}`}});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }
  async function load() {
    const revision = ++loadRevision.current;
    try {
      const { data: { session } } = await createClient().auth.getSession();
      const [data, savedLinks] = await Promise.all([request("/api/instagram/schedule"), session ? listScheduledClips(session.user.id) : Promise.resolve([])]);
      if (revision !== loadRevision.current) return;
      setPosts(data.posts); setLinks(savedLinks); setScheduler(data.scheduler || {enabled: false, message: "Scheduler status unavailable"});
      setPreview(current => current ? data.posts.find((post: Post) => post.id === current.id) || null : null);
    }
    catch(e) {if (revision === loadRevision.current) setError(e instanceof Error ? e.message : "Could not load schedule");}
  }
  useEffect(() => {
    const invalidateRequests = () => {++loadRevision.current;};
    const initial = window.setTimeout(() => void load(), 0);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => void load(), 30000);
    const connectionChanged = () => { setDraft(null); setSelected(null); setEditing(null); setDeleting(null); setDraggingPost(null); void load(); };
    window.addEventListener(INSTAGRAM_CONNECTION_CHANGED, connectionChanged);
    return () => {window.clearTimeout(initial);window.clearInterval(clock);window.clearInterval(refresh);window.removeEventListener(INSTAGRAM_CONNECTION_CHANGED, connectionChanged);invalidateRequests();};
  },[]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (highlighted) historyRef.current?.querySelector(`[data-history-clip-id="${CSS.escape(highlighted)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlighted]);
  function choose(clip: ClipHistoryItem,slot: Date, requestedAt: number) {
    if (working.current) return;
    if (!access.allowed) { setError(access.message); return; }
    if (!scheduler?.enabled) { setError(scheduler?.message || "Scheduler status unavailable"); return; }
    const time = calendarScheduleTime(slot, view === "days", requestedAt);
    if (!time) { setError("Past time slots cannot be scheduled"); return; }
    setDraft({clip,time:local(time)});setCaption("");setError("");setNotice("");
  }
  async function save() {
    if (!draft || working.current) return;
    if (!isFutureSchedule(draft.time, Date.now())) {setError("Choose a future time");return;}
    working.current = true;setBusy(true);setError("");setNotice("");
    try {
      if (!await access.refresh()) throw new Error("Instagram scheduling requires an active Pro membership. Check your account plan.");
      const worker = await request("/api/instagram/scheduler-status");
      setScheduler(worker);
      if (!worker.enabled) throw new Error(worker.message);
      const account = await request("/api/instagram/account");
      if (!account.connected) throw new Error("Connect Instagram in your user profile first");
      const res = await fetch(draft.clip.exportUrl!);
      if (!res.ok) throw new Error("Saved clip is unavailable");
      const blob = await res.blob();
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) throw new Error("Sign in to schedule posts");
      const mediaUrl = await uploadInstagramClip(blob, { Authorization: `Bearer ${session.access_token}` });
      const result = await request("/api/instagram/schedule",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mediaUrl,caption,igUserId:account.igUserId,scheduledAt:new Date(draft.time).toISOString()})});
      try {
        const { data: { session } } = await createClient().auth.getSession();
        if (!session) throw new Error("Session ended");
        await linkScheduledClip(session.user.id, result.post.id, draft.clip);
      } catch { setError("Post scheduled, but its history reference could not be saved in this browser"); }
      setDraft(null);setSelected(null);await load();
    } catch(e) {setError(e instanceof Error ? e.message : "Scheduling failed");}
    finally {working.current = false;setBusy(false);}
  }
  function edit(post: Post) {
    if (working.current || post.status !== "scheduled" || !access.allowed) return;
    setPreview(null);setEditing({post,time:local(new Date(post.scheduled_at))});setError("");setNotice("");
  }
  function confirmDelete(post: Post) {
    if (working.current || !["scheduled","failed"].includes(post.status)) return;
    setPreview(null);setDeleting(post);setError("");setNotice("");
  }
  async function move(post: Post, time: string, requestedAt: number) {
    if (working.current || post.status !== "scheduled") return;
    if (!isFutureSchedule(time, requestedAt)) {setError("Choose a future schedule time");return;}
    if (new Date(time).getTime() === new Date(post.scheduled_at).getTime()) {setEditing(null);return;}
    working.current = true;setBusy(true);setError("");setNotice("");++loadRevision.current;
    try {
      if (!await access.refresh()) throw new Error("Instagram scheduling requires an active Pro membership.");
      const result = await request(`/api/instagram/schedule/${encodeURIComponent(post.id)}`, {
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({scheduledAt:new Date(time).toISOString(),expectedScheduledAt:post.scheduled_at}),
      });
      ++loadRevision.current;
      setPosts(current => current.map(item => item.id === post.id ? {...item,...result.post} : item));
      setEditing(null);setNotice(`Post moved to ${new Date(result.post.scheduled_at).toLocaleString()}`);
    } catch(e) {setError(e instanceof Error ? e.message : "Could not move schedule");}
    finally {working.current = false;setBusy(false);await load();}
  }
  async function remove() {
    if (!deleting || working.current) return;
    const post = deleting;
    working.current = true;setBusy(true);setError("");setNotice("");++loadRevision.current;
    try {
      await request(`/api/instagram/schedule/${encodeURIComponent(post.id)}`, {
        method:"DELETE",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({expectedScheduledAt:post.scheduled_at}),
      });
      ++loadRevision.current;
      setPosts(current => current.filter(item => item.id !== post.id));
      setLinks(current => current.filter(item => item.postId !== post.id));
      setDeleting(null);setNotice("Schedule deleted. Saved clip kept.");
      try {
        const {data:{session}} = await createClient().auth.getSession();
        if (session) await unlinkScheduledClip(session.user.id,post.id);
      } catch { /* A stale local reference cannot restart a deleted schedule. */ }
    } catch(e) {setError(e instanceof Error ? e.message : "Could not delete schedule");}
    finally {working.current = false;setBusy(false);await load();}
  }
  function dialogKeys(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
    if (event.key === "Escape" && !busy) {event.stopPropagation();close();}
    if (event.key !== "Tab") return;
    const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]'));
    const first=fields[0], last=fields.at(-1);
    if (!first || !last) {event.preventDefault();return;}
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
  }
  function postName(post: Post) {
    const link=links.find(item => item.postId===post.id);
    return clips.find(item => item.id===link?.clipId)?.exportFileName || link?.name || `Instagram reel ${post.id.slice(0,8)}`;
  }
  const start = new Date(`${date}T00:00:00`);
  const previewLink = links.find(link => link.postId === preview?.id);
  const previewClip = clips.find(clip => clip.id === previewLink?.clipId);
  const previewUrl = previewClip?.exportUrl || preview?.preview_url;
  const previewSkipped = preview?.status === "scheduled" && !!scheduler?.notBefore && new Date(preview.scheduled_at) < new Date(scheduler.notBefore);
  const slots = Array.from({length:view === "days" ? 7 : 1440/Number(view)},(_,i) => {
    const time = new Date(start);const end = new Date(start);
    if (view === "days") {time.setDate(time.getDate()+i);end.setDate(end.getDate()+i+1);}
    else {time.setMinutes(i*Number(view));end.setMinutes((i+1)*Number(view));}
    return {time,end};
  });
  return <div className="flex flex-col md:flex-row flex-1 min-h-0 text-white">
    <aside ref={historyRef} className="w-full md:w-64 shrink-0 overflow-auto border-b md:border-b-0 md:border-r border-[#333] p-4 flex md:block gap-3 md:space-y-3">
      <h2 className="text-sm font-semibold shrink-0">Saved clips</h2>
      {!clips.length && <p className="text-xs text-[#999]">No saved clips</p>}
      {clips.map(c => <button key={c.id} data-history-clip-id={c.id} data-highlighted={highlighted === c.id} draggable={access.allowed && scheduler?.enabled === true} onDragStart={e => {e.dataTransfer.setData("application/x-clipmeme",c.id);e.dataTransfer.effectAllowed="copy";}} onClick={() => setSelected(c)} onMouseEnter={() => setHighlighted(c.id)} onMouseLeave={() => setHighlighted(null)} aria-pressed={selected?.id===c.id} className={`w-56 md:w-full shrink-0 p-2 flex gap-2 text-left border rounded transition-colors ${highlighted===c.id ? "border-[#53c6be] ring-1 ring-[#53c6be] bg-[#162625]" : selected?.id===c.id ? "border-red-400" : "border-[#333]"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.thumbnail && <img src={c.thumbnail} alt="" className="w-16 h-12 rounded object-cover" />}
        <span className="min-w-0 text-xs"><span className="block truncate">{c.exportFileName || "Exported clip"}</span><span className="text-[#999]">{c.duration.toFixed(1)}s · {c.aspectRatio}</span></span>
      </button>)}
    </aside>
    <section className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-[#333]">
        <h1 className="text-base font-semibold mr-auto">Instagram schedule</h1>
        <input aria-label="Calendar date" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} className={`${control} bg-[#222]`}/>
        <button className={control} onClick={() => setDate(local(new Date()).slice(0,10))}>Today</button>
        <div role="group" aria-label="Interval" className="flex">{[["60","Hourly"],["30","30 min"],["days","Days"]].map(([v,label]) => <button key={v} aria-pressed={view===v} className={`${control} ${view===v ? "bg-[#444]" : ""}`} onClick={() => setView(v)}>{label}</button>)}</div>
        <button title="Refresh schedule and membership" className={control} onClick={() => { void load(); void access.refresh(); }}><RefreshCw size={15}/></button>
        <span className="w-full text-xs text-[#999]">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        <p role="status" className={`w-full text-xs ${access.allowed && scheduler?.enabled ? "text-[#78cfc8]" : "text-[#ffca28]"}`}>{access.message || scheduler?.message || "Checking scheduler..."}</p>
      </div>
      {error && !draft && !editing && !deleting && <p role="alert" className="p-3 text-red-400 text-xs">{error}</p>}
      {notice && <p role="status" className="p-3 text-[#78cfc8] text-xs">{notice}</p>}
      <div className={`flex-1 overflow-auto ${view === "days" ? "grid grid-cols-[repeat(7,minmax(180px,1fr))]" : ""}`}>
        {slots.map(({time,end}) => {
          const future = calendarScheduleTime(time, view === "days", now) !== null;
          const available = !busy && access.allowed && future && (draggingPost !== null || scheduler?.enabled === true);
          const items = posts.filter(p => new Date(p.scheduled_at)>=time && new Date(p.scheduled_at)<end);
          return <div key={time.toISOString()} data-slot-start={time.toISOString()} data-slot-disabled={!available}
            onDragOver={e => {
              const moving = e.dataTransfer.types.includes("application/x-clipmeme-schedule");
              if (!busy && access.allowed && (moving || scheduler?.enabled) && calendarScheduleTime(time, view === "days", Date.now())) {
                e.preventDefault();e.dataTransfer.dropEffect=moving ? "move" : "copy";
              }
            }}
            onDrop={e => {
              e.preventDefault();setDraggingPost(null);
              const postId=e.dataTransfer.getData("application/x-clipmeme-schedule");
              if (postId) {
                const post=posts.find(item => item.id===postId && item.status==="scheduled");
                if (!post || !access.allowed || busy) return;
                const target=calendarMoveTime(post.scheduled_at,time,view==="days",Date.now());
                if (!target) {setError("Past time slots cannot be scheduled");return;}
                void move(post,target.toISOString(),Date.now());return;
              }
              const clip=clips.find(c => c.id===e.dataTransfer.getData("application/x-clipmeme"));if (clip) choose(clip,time,Date.now());
            }}
            className={`border-b border-r border-[#303030] p-2 ${available ? "hover:bg-[#202020]" : "bg-[#151515]"} ${view === "days" ? "min-h-64" : "flex gap-3 min-h-16"}`}>
            <button title={!future ? "Past time slot" : !scheduler?.enabled ? "Scheduler is off" : undefined} className={`w-20 shrink-0 self-start py-2 text-left text-xs ${available ? "text-[#aaa]" : "text-[#606060] cursor-not-allowed"}`} disabled={!selected || !available} onClick={() => selected && choose(selected,time,Date.now())}>{view === "days" ? time.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}) : time.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</button>
            <div className={`flex-1 min-w-0 flex flex-wrap content-start items-start gap-2 ${view === "days" ? "mt-2" : ""}`}>
              {items.map(post => {
                const link = links.find(item => item.postId === post.id);
                const clip = clips.find(item => item.id === link?.clipId);
                const name = postName(post);
                const thumbnail = clip?.thumbnail || link?.thumbnail;
                const skipped = post.status === "scheduled" && !!scheduler?.notBefore && new Date(post.scheduled_at) < new Date(scheduler.notBefore);
                const overdue = !skipped && post.status === "scheduled" && new Date(post.scheduled_at).getTime() < now - 60000;
                const accent = skipped ? "border-l-[#777]" : post.status === "failed" ? "border-l-red-400" : overdue ? "border-l-[#ffca28]" : post.status === "published" ? "border-l-green-400" : "border-l-[#53c6be]";
                const movable = post.status === "scheduled" && access.allowed && !busy;
                const removable = ["scheduled","failed"].includes(post.status);
                return <article key={post.id} data-post-id={post.id} data-post-status={post.status} draggable={movable}
                  onDragStart={e => {if (!movable) {e.preventDefault();return;} e.dataTransfer.setData("application/x-clipmeme-schedule",post.id);e.dataTransfer.effectAllowed="move";setDraggingPost(post.id);setSelected(null);}}
                  onDragEnd={() => setDraggingPost(null)}
                  onMouseEnter={() => setHighlighted(link?.clipId || null)} onMouseLeave={() => setHighlighted(null)}
                  onFocus={() => setHighlighted(link?.clipId || null)} onBlur={() => setHighlighted(null)}
                  className={`group rounded-md border border-[#3a3a3a] border-l-[3px] ${accent} ${view === "days" ? "w-full" : "w-[248px]"} max-w-full min-h-[132px] ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${link?.clipId && highlighted === link.clipId ? "bg-[#1b3432]" : "bg-[#242424]"}`}>
                  <button disabled={busy} aria-label={`Preview ${name}`} title={name} onClick={() => setPreview(post)} className="w-full flex gap-2 p-2 text-left rounded-t hover:bg-[#303030] focus-visible:outline-2 focus-visible:outline-[#53c6be]">
                  <span className="relative w-14 h-20 shrink-0 overflow-hidden rounded bg-[#141414] flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {thumbnail ? <img draggable={false} src={thumbnail} alt="" className="w-full h-full object-cover" /> : <Film size={22} className="text-[#777]" />}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"><Play size={20} fill="white" /></span>
                  </span>
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="block truncate font-semibold text-white">{name}</span>
                    <span className="block mt-1 text-[#aaa]">{new Date(post.scheduled_at).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</span>
                    <span className="block mt-1 line-clamp-2 break-words text-[#ddd]">{post.caption || "No caption"}</span>
                    <span className={`block mt-1 text-[10px] ${skipped ? "text-[#aaa]" : post.status === "failed" ? "text-red-400" : overdue ? "text-[#ffca28]" : "text-[#78cfc8]"}`}>{skipped ? "Skipped" : overdue ? "Overdue" : post.status}</span>
                  </span>
                  </button>
                  <div className="min-h-8 flex items-center justify-end gap-1 px-2 border-t border-[#383838]">
                    {movable && <span title="Drag to reschedule" className="text-[#999] mr-auto"><GripVertical size={14}/></span>}
                    {post.status === "scheduled" && <button draggable={false} disabled={!movable} title="Change scheduled time" aria-label={`Change time for ${name}`} onClick={() => edit(post)} className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#444] disabled:opacity-40"><CalendarClock size={15}/></button>}
                    {removable && <button draggable={false} disabled={busy} title="Delete schedule" aria-label={`Delete schedule for ${name}`} onClick={() => confirmDelete(post)} className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#53282c] text-red-300 disabled:opacity-40"><Trash2 size={15}/></button>}
                  </div>
                </article>;
              })}
            </div>
          </div>;
        })}
      </div>
    </section>
    {draft && <div role="dialog" aria-modal="true" aria-labelledby="schedule-title" onKeyDown={e => dialogKeys(e,() => setDraft(null))} className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-lg border border-[#444] bg-[#191919] p-5 space-y-4">
      <div className="flex justify-between"><h2 id="schedule-title">Schedule Instagram post</h2><button disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {draft.clip.thumbnail && <img src={draft.clip.thumbnail} alt="" className="w-14 h-16 object-cover rounded" />}
        <p className="min-w-0 break-words text-xs text-[#ccc]">{draft.clip.exportFileName || `Clip ${draft.clip.id}`}</p>
      </div>
      <label className="block text-xs">Date and time<input type="datetime-local" min={local(new Date(now + 60000))} value={draft.time} onChange={e => setDraft({...draft,time:e.target.value})} className="block w-full mt-2 p-2 bg-[#222] rounded"/></label>
      <label className="block text-xs">Caption<textarea rows={4} maxLength={2200} value={caption} onChange={e => setCaption(e.target.value)} className="block w-full mt-2 p-2 bg-[#222] rounded"/></label>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {!isFutureSchedule(draft.time,now) && <p role="alert" className="text-xs text-red-400">Choose a future date and time</p>}
      <button className={`${control} w-full bg-[#a72c35]`} disabled={!access.allowed || busy || !scheduler?.enabled || !isFutureSchedule(draft.time,now)} onClick={() => void save()}>{busy ? "Scheduling..." : "Schedule post"}</button>
    </div></div>}
    {editing && <div role="dialog" aria-modal="true" aria-labelledby="move-title" onKeyDown={e => dialogKeys(e,() => setEditing(null))} className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-lg border border-[#444] bg-[#191919] p-5 space-y-4">
        <div className="flex justify-between gap-3 items-center"><h2 id="move-title" className="text-sm font-semibold">Change scheduled time</h2><button disabled={busy} title="Close" aria-label="Close time editor" onClick={() => setEditing(null)} className="shrink-0 p-1"><X size={18}/></button></div>
        <p className="text-xs text-[#ccc] break-words">{postName(editing.post)}</p>
        <label className="block text-xs">Date and time<input autoFocus aria-label="New scheduled time" type="datetime-local" min={local(new Date(now+60000))} value={editing.time} disabled={busy} onChange={e => setEditing({...editing,time:e.target.value})} className="block w-full min-w-0 mt-2 p-2 bg-[#222] rounded"/></label>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        {!isFutureSchedule(editing.time,now) && <p role="alert" className="text-xs text-red-400">Choose a future date and time</p>}
        <div className="flex justify-end gap-2"><button disabled={busy} className={control} onClick={() => setEditing(null)}>Cancel</button><button disabled={busy || !access.allowed || !isFutureSchedule(editing.time,now)} className={`${control} bg-[#a72c35]`} onClick={() => void move(editing.post,editing.time,now)}>{busy ? "Saving..." : "Save changes"}</button></div>
      </div>
    </div>}
    {deleting && <div role="dialog" aria-modal="true" aria-labelledby="delete-title" onKeyDown={e => dialogKeys(e,() => setDeleting(null))} className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-lg border border-[#444] bg-[#191919] p-5 space-y-4">
        <h2 id="delete-title" className="text-sm font-semibold">Delete schedule?</h2>
        <p className="text-xs text-[#ccc] break-words">{postName(deleting)}</p>
        <p className="text-xs text-[#aaa]">{new Date(deleting.scheduled_at).toLocaleString()}</p>
        <p className="text-sm text-[#ddd]">This removes the schedule. Your saved clip stays in History. Posts already publishing cannot be deleted here.</p>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2"><button autoFocus disabled={busy} className={control} onClick={() => setDeleting(null)}>Cancel</button><button disabled={busy} className={`${control} bg-[#a72c35]`} onClick={() => void remove()}>{busy ? "Deleting..." : "Delete schedule"}</button></div>
      </div>
    </div>}
    {preview && <div role="dialog" aria-modal="true" aria-labelledby="preview-title" onKeyDown={e => dialogKeys(e,() => setPreview(null))} className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-[#444] bg-[#191919] p-5 space-y-3">
        <div className="flex gap-3 justify-between items-start"><h2 id="preview-title" className="min-w-0 text-sm break-words">{previewClip?.exportFileName || previewLink?.name || "Scheduled Instagram reel"}</h2><button autoFocus title="Close preview" aria-label="Close preview" onClick={() => setPreview(null)} className="shrink-0 p-1"><X size={18}/></button></div>
        {previewUrl ? <video crossOrigin="anonymous" controls playsInline preload="metadata" poster={previewClip?.thumbnail || previewLink?.thumbnail} src={previewUrl} className="w-full max-h-[50vh] bg-black rounded" /> : <p className="text-xs text-[#aaa]">Video preview unavailable</p>}
        <p className="text-xs text-[#aaa]">{new Date(preview.scheduled_at).toLocaleString()} · {previewSkipped ? "Skipped" : preview.status}</p>
        <p className="text-sm text-[#ddd] whitespace-pre-wrap break-words">{preview.caption || "No caption"}</p>
        {preview.error && <p className="text-xs text-red-400">{preview.error}</p>}
        <div className="flex flex-wrap gap-2">
          {previewClip && <button className={control} onClick={() => {setSelected(previewClip);setHighlighted(previewClip.id);setPreview(null);}}>Select in history</button>}
          {preview.status === "scheduled" && <button disabled={!access.allowed || busy} title="Change scheduled time" aria-label="Change scheduled time" className={control} onClick={() => edit(preview)}><CalendarClock size={16}/></button>}
          {["scheduled","failed"].includes(preview.status) && <button disabled={busy} title="Delete schedule" aria-label="Delete schedule" className={`${control} text-red-300`} onClick={() => confirmDelete(preview)}><Trash2 size={16}/></button>}
        </div>
      </div>
    </div>}
  </div>;
}

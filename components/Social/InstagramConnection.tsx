import { useCallback,useEffect,useRef,useState } from "react";
import { Camera,Link2,RefreshCw,Unplug } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { INSTAGRAM_CONNECTION_CHANGED,notifyInstagramConnectionChanged } from "@/lib/instagram-connection-events";
import type { InstagramDestination } from "@/lib/instagram-destinations";
const button="flex min-h-8 items-center justify-center gap-2 rounded border border-[#444] px-2 py-1.5 text-xs text-[#ddd] hover:bg-[#303030] disabled:opacity-40";
export default function InstagramConnection({userId}:{userId:string}) {
  const [accounts,setAccounts]=useState<InstagramDestination[]>([]);
  const [limit,setLimit]=useState(1);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [confirmation,setConfirmation]=useState<InstagramDestination|null>(null);
  const request=useRef<AbortController|null>(null),working=useRef(false);
  const headers=useCallback(async()=>{
    const {data:{session}}=await createClient().auth.getSession();
    if(!session || session.user.id!==userId)throw new Error("Sign in to this account again");
    return {Authorization:`Bearer ${session.access_token}`};
  },[userId]);
  const load=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    try {
      const auth=await headers();if(controller.signal.aborted)return;setLoading(true);setError("");
      const res=await fetch("/api/instagram/accounts",{headers:auth,cache:"no-store",signal:controller.signal});
      const data=await res.json();if(!res.ok)throw new Error(data.error || "Could not load accounts");
      if(!Array.isArray(data.accounts) || ![1,3].includes(data.limit))throw new Error("Invalid account list");
      if(!controller.signal.aborted){setAccounts(data.accounts);setLimit(data.limit);}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Could not load accounts");}
    finally{if(!controller.signal.aborted)setLoading(false);}
  },[headers]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>void load(),0);
    const refresh=()=>{if(!working.current)void load();};
    window.addEventListener("focus",refresh);window.addEventListener(INSTAGRAM_CONNECTION_CHANGED,refresh);
    return()=>{window.clearTimeout(timer);request.current?.abort();window.removeEventListener("focus",refresh);window.removeEventListener(INSTAGRAM_CONNECTION_CHANGED,refresh);};
  },[load]);
  async function connect() {
    if(working.current)return;working.current=true;setBusy(true);setError("");
    try{const res=await fetch("/api/instagram/connect",{headers:await headers()});const data=await res.json();if(!res.ok)throw new Error(data.error || "Could not connect Instagram");window.location.assign(data.authUrl);}
    catch(e){setError(e instanceof Error?e.message:"Connection failed");}
    finally{working.current=false;setBusy(false);}
  }
  async function disconnect() {
    if(!confirmation || working.current)return;working.current=true;setBusy(true);setError("");
    try {
      const res=await fetch("/api/instagram/account",{method:"DELETE",headers:{...await headers(),"Content-Type":"application/json"},body:JSON.stringify({accountId:confirmation.id})});
      const data=await res.json();if(!res.ok)throw new Error(data.error || "Disconnect failed");
      setAccounts(current=>current.filter(account=>account.id!==confirmation.id));setConfirmation(null);notifyInstagramConnectionChanged();
    }catch(e){setError(e instanceof Error?e.message:"Disconnect failed");}
    finally{working.current=false;setBusy(false);}
  }
  return <section aria-label="Instagram connection" className="mt-4 border-t border-[#333] pt-3 space-y-3">
    <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-xs font-semibold text-white"><Camera size={15}/>Instagram <span className="text-[#aaa]">{accounts.length}/{limit}</span></h2>
      <button className="p-1" title="Refresh Instagram accounts" aria-label="Refresh Instagram accounts" disabled={busy||loading} onClick={()=>void load()}><RefreshCw size={14}/></button></div>
    {loading?<p role="status">Loading accounts...</p>:!accounts.length?<p className="text-[#aaa]">Not connected</p>:accounts.map(account=><div key={account.id} className="flex items-center gap-2 border-b border-[#303030] pb-2">
      <span className="min-w-0 flex-1 break-all text-[#90dfae]">@{account.username}</span>
      <button title={`Reconnect @${account.username}`} aria-label={`Reconnect @${account.username}`} className="p-1.5" disabled={busy} onClick={()=>void connect()}><RefreshCw size={14}/></button>
      <button title={`Disconnect @${account.username}`} aria-label={`Disconnect @${account.username}`} className="p-1.5" disabled={busy||limit===1} onClick={()=>setConfirmation(account)}><Unplug size={14}/></button>
    </div>)}
    <button className={`${button} w-full`} disabled={busy||loading||accounts.length>=limit} onClick={()=>void connect()}><Link2 size={14}/>{accounts.length?"Connect another account":"Connect Instagram"}</button>
    {limit===1 && <p className="text-[#aaa]">Multi-account setup pending</p>}
    {confirmation && <div className="space-y-3"><p role="alert">Disconnect @{confirmation.username}? Queued automatic posts to this account will stop. Posts already publishing may finish. Manual reminders remain.</p><div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={()=>setConfirmation(null)}>Cancel</button><button className={button} disabled={busy} onClick={()=>void disconnect()}>Confirm disconnect</button>
    </div></div>}
    {error && <p role="alert" className="text-[#ff9b9b] break-words">{error}</p>}
  </section>;
}

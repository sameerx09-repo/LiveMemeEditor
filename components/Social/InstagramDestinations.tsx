import type { InstagramDestination } from "@/lib/instagram-destinations";
export default function InstagramDestinations({accounts,selected,onChange,disabled=false}:{accounts:InstagramDestination[];selected:string[];onChange:(ids:string[])=>void;disabled?:boolean}) {
  return <fieldset disabled={disabled} className="space-y-2 min-w-0"><legend className="text-xs text-[#bbb] mb-2">Instagram destinations</legend>
    {!accounts.length && <p className="text-xs text-[#aaa]">No connected accounts</p>}
    {accounts.map(account=><label key={account.id} className="flex items-start gap-2 text-xs text-white min-w-0">
      <input type="checkbox" checked={selected.includes(account.id)} onChange={event=>onChange(event.target.checked?[...selected,account.id]:selected.filter(id=>id!==account.id))}/>
      <span className="break-all">@{account.username}</span>
    </label>)}
  </fieldset>;
}

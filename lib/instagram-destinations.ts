export type InstagramDestination = { id: string; igUserId: string; username: string };
export function destinationIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 ||
      value.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ||
      new Set(value.map(id => String(id).toLowerCase())).size !== value.length) throw new Error("Select one to three distinct Instagram accounts");
  return value.map(id => id.toLowerCase());
}
export function manualHandles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length<1 || value.length>3 || value.some(handle=>typeof handle!=="string" || !/^@?[a-zA-Z0-9._]{1,30}$/.test(handle))) throw new Error("Enter one to three Instagram handles");
  const handles=value.map(handle=>handle.replace(/^@/,"").toLowerCase());
  if(new Set(handles).size!==handles.length) throw new Error("Choose distinct Instagram handles");
  return handles;
}

export function rememberedDestinations(userId:string,accounts:InstagramDestination[]) {
  try {
    const raw=localStorage.getItem(`instagram-destinations:${userId}`);
    if(raw!==null){const ids=JSON.parse(raw);if(Array.isArray(ids) && ids.length<=3)return ids.filter(id=>accounts.some(account=>account.id===id));}
  }catch { /* Storage is optional and never an entitlement source. */ }
  return accounts.slice(0,1).map(account=>account.id);
}
export function rememberDestinations(userId:string,ids:string[]) {
  try{localStorage.setItem(`instagram-destinations:${userId}`,JSON.stringify(ids));}catch { /* Private browsing may disable storage. */ }
}

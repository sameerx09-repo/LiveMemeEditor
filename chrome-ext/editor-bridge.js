// Fetch credentials only from the authenticated editor endpoint, never message data.
let credentialVersion = 0;
function clearToken() {
  try { chrome.storage.local.remove("clipmeme_auth_token"); } catch { /* Extension may have been reloaded. */ }
}
async function refreshToken() {
  const version = ++credentialVersion;
  try {
    const response = await fetch("/api/auth/token", { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Session unavailable");
    const { access_token: token } = await response.json();
    if (version !== credentialVersion) return;
    if (typeof token !== "string" || !token) throw new Error("Missing session");
    chrome.storage.local.set({ clipmeme_auth_token: token });
  } catch {
    if (version === credentialVersion) clearToken();
  }
}
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin ||
      event.data?.type !== "__CLIPMEME_AUTH_CHANGED__") return;
  if (event.data.signedOut === true) {
    ++credentialVersion; // A pending refresh must not restore a signed-out credential.
    clearToken();
  } else {
    void refreshToken();
  }
});
void refreshToken();

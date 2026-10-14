const WEBSITE_URL = "http://localhost:3000";
const status = document.getElementById("status");
const detail = document.getElementById("detail");
const plan = document.getElementById("plan");
const indicator = document.getElementById("indicator");
const refresh = document.getElementById("refresh");
const signin = document.getElementById("signin");
let revision = 0;
let controller;

for (const link of document.querySelectorAll("[data-path]")) link.href = WEBSITE_URL + link.dataset.path;
document.getElementById("version").textContent = chrome.runtime.getManifest().version;

function show(title, message, state = "") {
  status.textContent = title;
  detail.textContent = message;
  indicator.className = `indicator ${state}`;
}

async function checkAccount() {
  const current = ++revision;
  controller?.abort();
  const request = new AbortController();
  controller = request;
  const timeout = setTimeout(() => request.abort(), 8000);
  refresh.disabled = true;
  plan.hidden = true;
  signin.hidden = false;
  signin.textContent = "Sign in on website";
  show("Checking connection...", "Loading your account");
  try {
    const stored = await chrome.storage.local.get("clipmeme_auth_token");
    if (current !== revision) return;
    const token = stored.clipmeme_auth_token;
    if (typeof token !== "string" || !token) {
      show("Not connected", "Sign-in required");
      return;
    }
    const response = await fetch(`${WEBSITE_URL}/api/account/profile`, {
      headers: { Authorization: `Bearer ${token}` }, credentials: "omit", cache: "no-store", signal: request.signal,
    });
    if (current !== revision) return;
    if (response.status === 401) {
      show("Session expired", "Sign in again on the website", "error");
      return;
    }
    if (!response.ok) throw new Error("Account unavailable");
    const profile = await response.json();
    if (current !== revision) return;
    if (typeof profile.email !== "string" || !profile.id || !["free", "pro"].includes(profile.plan)) throw new Error("Invalid profile");
    show(profile.email || "Account connected", "Connected", "connected");
    plan.textContent = profile.plan === "pro" ? "Pro" : "Free";
    plan.hidden = false;
    signin.textContent = "Manage account";
    signin.href = `${WEBSITE_URL}/`;
  } catch {
    if (current === revision) show("Could not check connection", "Account service unavailable. Try again shortly.", "error");
  } finally {
    clearTimeout(timeout);
    if (current === revision) {
      refresh.disabled = false;
      if (plan.hidden) signin.href = `${WEBSITE_URL}/login`;
    }
  }
}

refresh.addEventListener("click", checkAccount);
window.addEventListener("focus", checkAccount);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.clipmeme_auth_token) void checkAccount();
});
void checkAccount();

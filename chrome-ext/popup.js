const toggle = document.getElementById("site-toggle");
const hostnameEl = document.getElementById("hostname");
const statusText = document.getElementById("status-text");
const serverStatus = document.getElementById("server-status");

let currentTab = null;
let currentHostname = "";
let enabledSites = {};

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  currentTab = tab;
  try {
    currentHostname = new URL(tab.url).hostname;
  } catch {
    currentHostname = "";
  }
  hostnameEl.textContent = currentHostname || "unknown site";

  chrome.storage.sync.get("enabledSites", ({ enabledSites: stored = {} }) => {
    enabledSites = stored;
    const isEnabled = !!enabledSites[currentHostname];
    toggle.checked = isEnabled;
    setStatus(isEnabled);
  });
});

toggle.addEventListener("change", () => {
  const isEnabled = toggle.checked;
  setStatus(isEnabled);

  if (isEnabled) {
    enabledSites[currentHostname] = true;
    chrome.tabs.sendMessage(currentTab.id, { type: "CM_ENABLE_SITE" });
  } else {
    delete enabledSites[currentHostname];
    chrome.tabs.sendMessage(currentTab.id, { type: "CM_DISABLE_SITE" });
  }
  chrome.storage.sync.set({ enabledSites });
});

function setStatus(on) {
  statusText.textContent = on ? "Enabled" : "Disabled";
  statusText.className = "status " + (on ? "on" : "off");
}

// Check if ClipMeme server is running
fetch("http://localhost:3000/api/ping")
  .then(() => {
    serverStatus.style.color = "#4caf50";
    serverStatus.textContent = "✓ ClipMemeEditor running on :3000";
  })
  .catch(() => {
    serverStatus.style.color = "#ef5350";
    serverStatus.innerHTML = '✗ ClipMemeEditor not running &mdash; <a href="http://localhost:3000" target="_blank">start it</a>';
  });

const CLIPMEMEEDITOR_URL = "http://localhost:3000";

// When auth token is stored/refreshed, tell all content scripts so pending clips can retry
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.clipmeme_auth_token?.newValue) {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "CM_TOKEN_READY" }).catch(() => {});
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from this extension's own content scripts or internal pages.
  // External senders (sender.id !== chrome.runtime.id) are rejected.
  if (sender.id && sender.id !== chrome.runtime.id) return;

  if (msg.type === "OPEN_CLIPMEMEEDITOR") {
    // sender.id check above already validates this is our own extension
    if (typeof msg.url !== "string" || !msg.url.startsWith(`${CLIPMEMEEDITOR_URL}/`)) return;
    chrome.tabs.create({ url: msg.url });
  }

  if (msg.type === "GET_TAB_AUDIO_STREAM_ID") {
    if (!sender.tab) {
      sendResponse({ error: "Capture must start from a video tab" });
      return;
    }
    chrome.tabCapture.getMediaStreamId(
      { targetTabId: sender.tab.id, consumerTabId: sender.tab.id },
      (streamId) => sendResponse({ streamId: streamId || null, error: chrome.runtime.lastError?.message })
    );
    return true;
  }

});

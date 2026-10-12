// Notify the isolated bridge without copying credentials through page messages.
function notifyAuthChange() {
  window.postMessage({ type: "__CLIPMEME_AUTH_CHANGED__" }, window.location.origin);
}
notifyAuthChange();
window.addEventListener("storage", notifyAuthChange);

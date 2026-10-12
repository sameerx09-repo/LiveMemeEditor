export const INSTAGRAM_CONNECTION_CHANGED = "clipmeme:instagram-connection-changed";

export function notifyInstagramConnectionChanged() {
  window.dispatchEvent(new Event(INSTAGRAM_CONNECTION_CHANGED));
}

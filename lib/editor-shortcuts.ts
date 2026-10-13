export function isEditorShortcutAllowed(event: KeyboardEvent, active: boolean, busy = false): boolean {
  if (!active || busy || event.defaultPrevented || event.isComposing || event.repeat ||
      event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest?.('input,textarea,select,button,a,video,audio,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="tab"]');
}

import { isEditorShortcutAllowed } from "@/lib/editor-shortcuts";

function event(overrides: Partial<KeyboardEvent> = {}, interactive = false) {
  return { defaultPrevented: false, isComposing: false, repeat: false, ctrlKey: false,
    metaKey: false, altKey: false, target: { closest: () => interactive ? {} : null },
    ...overrides } as unknown as KeyboardEvent;
}
test("calendar never receives editor playback, export or editing shortcuts", () => {
  for (const key of [" ", "c", "C", "[", "]", "ArrowLeft", "Delete"]) {
    expect(isEditorShortcutAllowed(event({ key }), false)).toBe(false);
  }
});
test("editor background retains unmodified shortcuts", () => {
  expect(isEditorShortcutAllowed(event(), true)).toBe(true);
});
test("native controls and dialogs keep their own keyboard behavior", () => {
  expect(isEditorShortcutAllowed(event({}, true), true)).toBe(false);
});
test.each(["ctrlKey", "metaKey", "altKey", "isComposing", "repeat", "defaultPrevented"] as const)("ignores %s events", flag => {
  expect(isEditorShortcutAllowed(event({ [flag]: true }), true)).toBe(false);
});
test("cannot trigger a new shortcut while exporting", () => {
  expect(isEditorShortcutAllowed(event(), true, true)).toBe(false);
});

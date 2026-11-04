// Keep a table editor's native text nodes alive until the IME's final input
// event has run. WebKit can report compositionend before its committing key.
export const editorCompositionSettledEvent = "editor-composition-settled";
const sessions = new WeakMap<HTMLElement, { active: boolean; timer: ReturnType<typeof setTimeout> | null }>();

export function isEditorComposing(editor: HTMLElement | null) {
  const session = editor && sessions.get(editor);
  return !!session && (session.active || session.timer !== null);
}

export function trackEditorComposition(editor: HTMLElement, onSettled: () => void) {
  const session = { active: false, timer: null as ReturnType<typeof setTimeout> | null };
  sessions.set(editor, session);
  const cancel = () => { if (session.timer !== null) clearTimeout(session.timer); session.timer = null; };
  const start = () => { cancel(); session.active = true; };
  const settle = () => {
    cancel();
    session.timer = setTimeout(() => {
      session.timer = null;
      session.active = false;
      if (sessions.get(editor) === session) onSettled();
    }, 0);
  };
  const end = () => { session.active = false; settle(); };
  const input = () => { if (!session.active && session.timer !== null) settle(); };
  // Blurring first lets the browser commit its marked text before another
  // cell becomes editable. Also covers engines that omit compositionend on blur.
  const blur = () => { if (isEditorComposing(editor)) end(); };
  editor.addEventListener("compositionstart", start);
  editor.addEventListener("compositionend", end);
  editor.addEventListener("input", input);
  editor.addEventListener("blur", blur);
  return () => {
    cancel();
    sessions.delete(editor);
    editor.removeEventListener("compositionstart", start);
    editor.removeEventListener("compositionend", end);
    editor.removeEventListener("input", input);
    editor.removeEventListener("blur", blur);
  };
}

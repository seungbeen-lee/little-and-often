import { isEditorComposing } from "./editor-composition";
import { normalizeListMarkers } from "./list-markers";

// Store lists as visible bullets and indentation in the existing text format.
// No new card schema or HTML-only state: previews, keywords and autosave see the
// same characters, and existing hyphenated cards are never migrated on read.
const itemPattern = /^([ \t]*)•[ \u00a0]?/u;
const indent = "    ";
// List breaks insert their own newline and bypass native line-break input.
export const editorListLineBreakEvent = "editor-list-line-break";
type Edit = { start: number; end: number; text: string };
export type ListEdit = { edits: Edit[]; anchor: number; focus: number };

export function planEditorListKey(text: string, anchor: number, focus: number, key: string, shift = false): ListEdit | null {
  // A pasted list may still have its original glyph in the live editor until
  // blur. Recognize it without rewriting text nodes or shifting the selection.
  text = normalizeListMarkers(text);
  const start = Math.min(anchor, focus), end = Math.max(anchor, focus);
  const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", start);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const prefix = itemPattern.exec(line);
  const replace = (from: number, to: number, value: string): ListEdit => ({ edits: [{ start: from, end: to, text: value }], anchor: from + value.length, focus: from + value.length });
  if (key === " " && !shift && start === end && /^[ \t]*-$/u.test(text.slice(lineStart, start))) {
    return replace(start - 1, start, "• ");
  }
  if (!prefix) return null;
  if (key === "Enter" && shift) {
    if (start === end && !line.slice(prefix[0].length).trim()) {
      const remaining = prefix[1].length ? prefix[0].slice(Math.min(indent.length, prefix[1].length)) : "";
      return replace(lineStart, lineStart + line.length, remaining);
    }
    return replace(start, end, `\n${prefix[0]}${prefix[0].endsWith("•") ? " " : ""}`);
  }
  if (key === "Backspace" && !shift && start === end && start === lineStart + prefix[0].length) {
    const count = prefix[1].length ? Math.min(indent.length, prefix[1].length) : prefix[0].length;
    return { edits: [{ start: lineStart, end: lineStart + count, text: "" }], anchor: start - count, focus: focus - count };
  }
  if (key !== "Tab") return null;
  const lines: { start: number; prefix: RegExpExecArray }[] = [];
  let at = lineStart;
  const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
  while (at <= last) {
    const next = text.indexOf("\n", at), value = text.slice(at, next < 0 ? text.length : next);
    const match = itemPattern.exec(value);
    if (!match) return null; // A selection crossing ordinary text keeps normal Tab navigation.
    lines.push({ start: at, prefix: match });
    if (next < 0) break;
    at = next + 1;
  }
  // A nested item needs a preceding parent; don't create a detached first child.
  const previousLine = text.slice(0, Math.max(0, lineStart - 1)).split("\n").at(-1) ?? "";
  const previous = itemPattern.exec(previousLine);
  if (!shift && (!previous || prefix[1].length > previous[1].length)) return { edits: [], anchor, focus };
  const edits = lines.map(({ start, prefix }): Edit => shift
    ? { start, end: start + (prefix[1].length ? Math.min(indent.length, prefix[1].length) : prefix[0].length), text: "" }
    : { start, end: start, text: indent });
  const moved = (offset: number) => edits.reduce((result, edit) => result + (offset >= edit.end ? edit.text.length - (edit.end - edit.start) : offset > edit.start ? edit.text.length - (offset - edit.start) : 0), offset);
  return { edits, anchor: moved(anchor), focus: moved(focus) };
}

type Point = [Node, number];
// BRs and browser-created DIV/P lines both count, without changing live IME DOM.
function editorText(root: Node) {
  let text = "";
  const points: Point[] = [[root, 0]];
  const newline = (after: Point) => { text += "\n"; points.push(after); };
  const walk = (parent: Node) => {
    Array.from(parent.childNodes).forEach((node, index) => {
      if (node.nodeType === Node.TEXT_NODE) {
        points[text.length] = [node, 0];
        const value = node.textContent ?? "";
        for (let i = 0; i < value.length; i++) { text += value[i]; points.push([node, i + 1]); }
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === "BR") { points[text.length] = [parent, index]; newline([parent, index + 1]); return; }
      const block = /^(DIV|P|LI)$/u.test(node.tagName);
      if (block && text && !text.endsWith("\n")) newline([node, 0]);
      if (block) points[text.length] = [node, 0];
      walk(node);
      if (block && node.nextSibling && text && !text.endsWith("\n")) newline([parent, index + 1]);
    });
  };
  walk(root);
  return { text, points };
}

function pointOffset(editor: HTMLElement, node: Node, offset: number) {
  const path: number[] = [];
  for (let current = node; current !== editor; current = current.parentNode!) path.unshift(Array.prototype.indexOf.call(current.parentNode!.childNodes, current));
  const clone = editor.cloneNode(true);
  let target = clone;
  for (const index of path) target = target.childNodes[index];
  const marker = "\uFDD0", range = document.createRange();
  range.setStart(target, offset); range.collapse(true); range.insertNode(document.createTextNode(marker));
  return editorText(clone).text.indexOf(marker);
}

function editList(editor: HTMLElement, key: string, shift = false) {
  const selection = window.getSelection();
  if (!editor.isContentEditable || !selection?.anchorNode || !selection.focusNode
    || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return false;
  const anchor = pointOffset(editor, selection.anchorNode, selection.anchorOffset), focus = pointOffset(editor, selection.focusNode, selection.focusOffset);
  const plan = planEditorListKey(editorText(editor).text, anchor, focus, key, shift);
  if (!plan) return false;
  // One logical input/history entry, including a multi-line indent operation.
  const suppress = (event: Event) => event.stopImmediatePropagation();
  editor.addEventListener("input", suppress, true);
  try {
    for (const edit of [...plan.edits].reverse()) {
      const { points } = editorText(editor), range = document.createRange();
      range.setStart(...points[edit.start]); range.setEnd(...points[edit.end]);
      selection.removeAllRanges(); selection.addRange(range);
      document.execCommand("insertText", false, edit.text);
    }
    // Removing the last empty bullet can leave a zero-height DIV. Give that
    // browser-created empty line its usual BR placeholder so the caret stays
    // on this line instead of snapping back into the preceding list item.
    editor.querySelectorAll("div:empty,p:empty").forEach((line) => line.appendChild(document.createElement("br")));
    const { points } = editorText(editor);
    selection.setBaseAndExtent(...points[Math.min(plan.anchor, points.length - 1)], ...points[Math.min(plan.focus, points.length - 1)]);
  } finally { editor.removeEventListener("input", suppress, true); }
  if (plan.edits.length) {
    if (key === "Enter" && shift) editor.dispatchEvent(new Event(editorListLineBreakEvent));
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }
  return true;
}

type ListKeyEvent = { target: EventTarget | null; key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; keyCode: number; defaultPrevented: boolean; nativeEvent?: { isComposing?: boolean }; preventDefault(): void; stopPropagation(): void };
export function handleEditorListKey(event: ListKeyEvent) {
  if (event.defaultPrevented || event.nativeEvent?.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey
    || ![" ", "Tab", "Enter", "Backspace"].includes(event.key)) return false;
  const editor = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-editor-lists="true"]') : null;
  if (!editor || isEditorComposing(editor) || !editList(editor, event.key, event.shiftKey)) return false;
  event.preventDefault(); event.stopPropagation(); return true;
}

export function handleEditorListBeforeInput(editor: HTMLElement, event: InputEvent) {
  if (event.defaultPrevented || !event.cancelable || event.isComposing || isEditorComposing(editor)) return;
  // insertLineBreak is Shift+Enter; ordinary Enter/insertParagraph keeps the
  // surrounding editor's existing navigation or paragraph behavior.
  const key = event.inputType === "insertText" && event.data === " " ? " " : event.inputType === "insertLineBreak" ? "Enter" : null;
  if (key && editList(editor, key, key === "Enter")) event.preventDefault();
}

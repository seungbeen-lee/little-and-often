"use client";

import { useEffect, type RefObject } from "react";
import { editorListLineBreakEvent } from "../lib/editor-lists";
import { copyCardSelection, internalCardMarkup } from "../lib/editor-clipboard";
import { editorCompositionSettledEvent, isEditorComposing, trackEditorComposition } from "../lib/editor-composition";

// Explicit cursor toggles are local to the active editor, never saved as card data.
// Absence means inherited formatting, which still ends at a space/newline.
const manualBold = new WeakMap<HTMLElement, boolean>();
// Preserve plain typing across deletion/DOM refresh, but only for the current
// editing sequence. Moving to another keyword restores its own formatting.
const plainAfterEdit = new WeakSet<HTMLElement>();
const preservingTyping = new WeakSet<HTMLElement>();

export function blurEditorPreservingTyping(editor: HTMLElement) {
  preservingTyping.add(editor);
  try { editor.blur(); } finally { preservingTyping.delete(editor); }
}

export function clearManualEditorBold(editor: HTMLElement) {
  manualBold.delete(editor);
  plainAfterEdit.delete(editor);
}

export function hasManualEditorBold(editor: HTMLElement) {
  return manualBold.has(editor);
}

function boldAncestor(editor: HTMLElement, node: Node) {
  let bold: HTMLElement | null = null;
  for (let element = node instanceof HTMLElement ? node : node.parentElement;
    element && element !== editor; element = element.parentElement) {
    if (/^(B|STRONG)$/.test(element.tagName) || element.style.fontWeight === "bold"
      || Number.parseInt(element.style.fontWeight, 10) >= 600) bold = element;
  }
  return bold;
}

function plainTypingRange(editor: HTMLElement) {
  const selection = window.getSelection();
  if (document.activeElement !== editor || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer) || !document.queryCommandState("bold")) return;
  const startBold = boldAncestor(editor, range.startContainer);
  const endBold = boldAncestor(editor, range.endContainer);
  if (startBold && startBold === endBold) {
    const before = range.cloneRange(), after = range.cloneRange();
    before.selectNodeContents(startBold);
    before.setEnd(range.startContainer, range.startOffset);
    after.selectNodeContents(startBold);
    after.setStart(range.endContainer, range.endOffset);
    // Interior edits remain part of the existing keyword. At its boundary,
    // only an explicit separator ends bold typing (checked by beforeInput).
    if (range.collapsed ? before.toString().length && after.toString().length
      : before.toString().length || after.toString().length) return;
  }
  return range;
}

function withoutStyleInput(editor: HTMLElement, change: () => void) {
  // Let the browser insert the actual text (and manage its IME). The temporary
  // typing-style change is not a separate content edit or autosave/history step.
  const ignoreStyleInput = (event: Event) => {
    if ((event as InputEvent).inputType === "formatBold") event.stopImmediatePropagation();
  };
  editor.addEventListener("input", ignoreStyleInput, true);
  try { change(); }
  finally { editor.removeEventListener("input", ignoreStyleInput, true); }
}

function preparePlainTyping(editor: HTMLElement) {
  if (plainTypingRange(editor)) {
    plainAfterEdit.add(editor);
    withoutStyleInput(editor, () => document.execCommand("bold"));
  }
}

function applyPlainAfterEdit(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!plainAfterEdit.has(editor) || document.activeElement !== editor || !selection?.isCollapsed
    || !selection.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return false;
  if (document.queryCommandState("bold")) withoutStyleInput(editor, () => document.execCommand("bold"));
  return true;
}

export function toggleCaretBold(editor: HTMLElement | null) {
  const selection = window.getSelection();
  if (!editor || document.activeElement !== editor || !selection?.isCollapsed || !selection.rangeCount
    || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return false;
  // A collapsed toggle changes only the browser's typing style, not saved text.
  // Do not emit an empty content edit or run the selected-keyword toggle fallback.
  const next = !(manualBold.get(editor) ?? (plainAfterEdit.has(editor) ? false : document.queryCommandState("bold")));
  plainAfterEdit.delete(editor);
  if (document.queryCommandState("bold") !== next) withoutStyleInput(editor, () => document.execCommand("bold"));
  manualBold.set(editor, next);
  return true;
}

function applyManualBold(editor: HTMLElement) {
  const bold = manualBold.get(editor);
  if (bold === undefined) return false;
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount || document.activeElement !== editor
    || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    clearManualEditorBold(editor);
    return false;
  }
  // Restore the chosen typing style even after a newline or saved-format refresh.
  if (document.queryCommandState("bold") !== bold) withoutStyleInput(editor, () => document.execCommand("bold"));
  return true;
}

function finishPlainComposition(editor: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!text || !selection?.isCollapsed || !selection.rangeCount || document.activeElement !== editor) return;
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.commonAncestorContainer)) return;
  const before = caret.cloneRange();
  before.selectNodeContents(editor); before.setEnd(caret.endContainer, caret.endOffset);
  const end = before.toString().length, start = end - text.length;
  if (start < 0) return;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let remaining = start;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (remaining > (node.textContent?.length ?? 0)) { remaining -= node.textContent?.length ?? 0; continue; }
    const word = caret.cloneRange(); word.setStart(node, remaining);
    if (word.toString() !== text) return;
    selection.removeAllRanges(); selection.addRange(word);
    if (document.queryCommandState("bold")) withoutStyleInput(editor, () => document.execCommand("bold"));
    selection.collapseToEnd();
    return;
  }
}

function clipboardText(data: DataTransfer) {
  if (data.types.includes("text/plain")) return data.getData("text/plain");
  if (!data.types.includes("text/html")) return null;
  // Some sources provide HTML only. Extract text in an inert template; never
  // attach external markup/styles/resources to the live editor.
  const template = document.createElement("template");
  template.innerHTML = data.getData("text/html");
  template.content.querySelectorAll("script,style,noscript,template").forEach(node => node.remove());
  template.content.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  template.content.querySelectorAll("td,th").forEach(node => node.append("\t"));
  template.content.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre").forEach(node => node.append("\n"));
  return (template.content.textContent ?? "").replace(/\n$/, "");
}

export function usePlainEditorTyping(ref: RefObject<HTMLDivElement | null>, enabled = true) {
  useEffect(() => {
    const editor = ref.current;
    if (!editor || !enabled) return;
    let composing = false;
    let plainComposition = false;
    let compositionText = "";
    const stopTracking = editor.hasAttribute("data-table-editor") ? trackEditorComposition(editor, () => {
      if (plainComposition) finishPlainComposition(editor, compositionText);
      plainComposition = false;
      composing = false;
      editor.dispatchEvent(new Event(editorCompositionSettledEvent));
    }) : undefined;
    const beforeInput = (event: InputEvent) => {
      if (composing || event.isComposing || isEditorComposing(editor)) return;
      if (event.inputType.startsWith("delete")) {
        // The browser can inherit the preceding bold run after deleting plain
        // text or its separator. Remember the pre-deletion typing style.
        if (!manualBold.has(editor) && !document.queryCommandState("bold")) plainAfterEdit.add(editor);
        return;
      }
      if (!["insertText", "insertReplacementText", "insertParagraph", "insertLineBreak"].includes(event.inputType)) return;
      if (applyManualBold(editor) || applyPlainAfterEdit(editor)) return;
      const range = plainTypingRange(editor);
      const separator = event.inputType === "insertParagraph" || event.inputType === "insertLineBreak"
        || /^\s/u.test(event.data ?? "");
      if (range && (!range.collapsed || separator)) preparePlainTyping(editor);
    };
    const compositionStart = () => {
      const range = applyManualBold(editor) || applyPlainAfterEdit(editor) ? undefined : plainTypingRange(editor);
      plainComposition = !!range && !range.collapsed;
      // Do not unbold selected content before it is actually replaced: cancelling
      // composition must leave the original keyword intact.
      // Appended Korean composition continues the keyword. A later space or
      // newline ends bold through beforeInput, after composition has committed.
      composing = true;
    };
    const paste = (event: ClipboardEvent) => {
      // ImageField handles image attachments in capture phase. Respect it, and
      // leave non-text clipboard data to the existing attachment flow.
      if (event.defaultPrevented || !event.clipboardData || !editor.isContentEditable) return;
      const internal = internalCardMarkup(event.clipboardData);
      if (internal !== null) {
        event.preventDefault();
        if (internal) document.execCommand("insertHTML", false, internal);
        return;
      }
      const text = clipboardText(event.clipboardData);
      if (text === null) return;
      event.preventDefault();
      if (!text) return;
      // Use the existing destination typing rules, including explicit Cmd+B.
      // insertText preserves selection replacement, line breaks and undo while
      // keeping all clipboard HTML formatting out of the editor.
      beforeInput(new InputEvent("beforeinput", { inputType: "insertText", data: text }));
      document.execCommand("insertText", false, text);
    };
    const copy = (event: ClipboardEvent) => { copyCardSelection(event, editor); };
    const cut = (event: ClipboardEvent) => {
      if (editor.isContentEditable && copyCardSelection(event, editor)) document.execCommand("delete");
    };
    const compositionEnd = (event: CompositionEvent) => {
      if (stopTracking) { compositionText = event.data; return; }
      if (plainComposition) finishPlainComposition(editor, event.data);
      plainComposition = false;
      composing = false;
    };
    const resetManual = () => { if (!preservingTyping.has(editor)) clearManualEditorBold(editor); };
    const listLineBreak = () => {
      // Explicit cursor toggles survive breaks. Inherited/block formatting
      // ends after the break has placed the caret on the new line, including
      // a break in the middle of a bold run where beforeinput cannot unbold it.
      if (applyManualBold(editor)) return;
      plainAfterEdit.add(editor);
      applyPlainAfterEdit(editor);
    };
    const resetPlain = () => plainAfterEdit.delete(editor);
    const navigate = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (/^(Arrow|Home$|End$|Page)/.test(event.key)
        || ((event.metaKey || event.ctrlKey) && (event.code === "KeyA" || event.key.toLowerCase() === "a"))) resetPlain();
    };
    const input = (event: Event) => {
      const native = event as InputEvent;
      if (["insertParagraph", "insertLineBreak"].includes(native.inputType)
        && document.activeElement === editor && !composing && !native.isComposing && !isEditorComposing(editor)) listLineBreak();
      // A selected-text command starts inherited formatting again. Cursor-only
      // toggles suppress this style event and set manualBold explicitly above.
      if (["formatBold", "formatRemove", "historyUndo", "historyRedo"].includes((event as InputEvent).inputType)) resetManual();
    };
    editor.addEventListener("beforeinput", beforeInput);
    editor.addEventListener("paste", paste);
    editor.addEventListener("copy", copy);
    editor.addEventListener("cut", cut);
    editor.addEventListener("input", input);
    editor.addEventListener(editorListLineBreakEvent, listLineBreak);
    editor.addEventListener("pointerdown", resetPlain);
    editor.addEventListener("keydown", navigate);
    editor.addEventListener("blur", resetManual);
    editor.addEventListener("compositionstart", compositionStart);
    editor.addEventListener("compositionend", compositionEnd);
    return () => {
      stopTracking?.();
      editor.removeEventListener("beforeinput", beforeInput);
      editor.removeEventListener("paste", paste);
      editor.removeEventListener("copy", copy);
      editor.removeEventListener("cut", cut);
      editor.removeEventListener("input", input);
      editor.removeEventListener(editorListLineBreakEvent, listLineBreak);
      editor.removeEventListener("pointerdown", resetPlain);
      editor.removeEventListener("keydown", navigate);
      editor.removeEventListener("blur", resetManual);
      resetManual();
      editor.removeEventListener("compositionstart", compositionStart);
      editor.removeEventListener("compositionend", compositionEnd);
    };
  }, [ref, enabled]);
}

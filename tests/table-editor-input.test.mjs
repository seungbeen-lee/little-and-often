import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
import { createServer } from "vite";

// This exercises React's actual event handlers and live contenteditable nodes.
// jsdom supplies DOM/event semantics, not Safari's native IME or visual layout.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const name of ["window", "document", "navigator", "Node", "NodeFilter", "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLFormElement", "HTMLSelectElement", "Text", "DocumentFragment", "Event", "InputEvent", "CompositionEvent", "KeyboardEvent", "FocusEvent", "CustomEvent", "MutationObserver", "Range"]) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.scrollTo = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Object.defineProperty(dom.window.HTMLElement.prototype, "isContentEditable", {
  configurable: true,
  get() { return this.closest('[contenteditable]')?.getAttribute("contenteditable") === "true"; },
});
dom.window.matchMedia = query => ({ matches: !query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} });

// Native editing commands are outside jsdom. Model their selection/DOM effects
// so formatting and list tests still run through the production event handlers.
document.queryCommandState = command => {
  if (command !== "bold") return false;
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  return Boolean((node instanceof Element ? node : node?.parentElement)?.closest("strong,b"));
};
document.execCommand = (command, _showUI, value) => {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const editor = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest('[contenteditable="true"]');
  if (!editor) return false;
  if (command === "insertText") {
    range.deleteContents();
    const node = document.createTextNode(value ?? "");
    range.insertNode(node);
    range.setStartAfter(node); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
  } else if (command === "bold" && !range.collapsed) {
    const bold = (selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement)?.closest("strong,b");
    if (bold && bold.contains(selection.focusNode)) {
      const contents = [...bold.childNodes];
      bold.replaceWith(...contents);
      range.selectNodeContents(editor);
    } else {
      const wrapper = document.createElement("strong");
      wrapper.style.fontWeight = "700";
      wrapper.append(range.extractContents()); range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
    }
    selection.removeAllRanges(); selection.addRange(range);
  }
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: command === "bold" ? "formatBold" : "insertText" }));
  return true;
};

const { createRoot } = await import("react-dom/client");
const rootPath = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root: rootPath, resolve: { alias: { "@": rootPath } }, server: { middlewareMode: true, hmr: false, ws: false } });
const { CellEditor, TableRegistration } = await vite.ssrLoadModule("/components/table-card.tsx");
const { FormattedTextEditor, BulkCreateDialog } = await vite.ssrLoadModule("/app/study-app.tsx");
const { createTable, editCell, plainCell, encodeTable } = await vite.ssrLoadModule("/lib/table-card.ts");
let mountedRoot;
afterEach(() => {
  if (mountedRoot) act(() => mountedRoot.unmount());
  mountedRoot = null;
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});
after(async () => { await vite.close(); dom.window.close(); });

function caret(node, offset = node.nodeType === Node.TEXT_NODE ? node.textContent.length : node.childNodes.length) {
  const selection = window.getSelection();
  selection.setBaseAndExtent(node, offset, node, offset);
}
function key(editor, name, extra = {}) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, isComposing: false, keyCode: 0, ...extra });
  act(() => editor.dispatchEvent(event));
  return event;
}
function composition(editor, name, data = "") {
  act(() => editor.dispatchEvent(new CompositionEvent(name, { bubbles: true, data })));
}
function input(editor, extra = {}) {
  act(() => editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", ...extra })));
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }

function mount(format = "") {
  const host = document.createElement("div"); document.body.append(host);
  let initial = createTable(1, 2);
  initial = editCell(initial, initial.cells[0].id, format);
  const state = { doc: initial, changes: [], navigations: [], deleted: 0, replace: null };
  function Harness() {
    const [doc, setDoc] = useState(initial);
    state.doc = doc; state.replace = setDoc;
    return React.createElement(React.Fragment, null,
      React.createElement(CellEditor, { cell: doc.cells[0], editing: true,
        onChange: value => { state.changes.push(value); setDoc(previous => editCell(previous, previous.cells[0].id, value)); },
        onNavigate: (name, reverse) => { state.navigations.push([name, reverse]); host.querySelector("input").focus(); return true; },
        onDelete: () => { state.deleted++; return true; },
      }), React.createElement("input", { "aria-label": "다음 칸" }));
  }
  mountedRoot = createRoot(host);
  act(() => mountedRoot.render(React.createElement(Harness)));
  const editor = host.querySelector('[data-table-editor]');
  act(() => { editor.focus(); caret(editor); });
  return { editor, next: host.querySelector("input"), state };
}

function click(element, detail = 1) {
  act(() => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail })));
}

test("Enter in a new section adds one card immediately beneath it and focuses classification", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const previousScroll = dom.window.HTMLElement.prototype.scrollTo;
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  mountedRoot = createRoot(host);
  try {
    await act(async () => mountedRoot.render(React.createElement(BulkCreateDialog, {
      open: true, onOpenChange() {}, initialSubject: "과학", initialSet: null, initialSelectedCardId: null,
      startInSetMode: false, subjects: ["과학"], cards: [], onSaved() {}, onCardArchived() {}, onSetSaved() {}, onView() {},
    })));
    const sectionButton = [...document.querySelectorAll('.bulk-insert-button-group button')].find(button => button.textContent.trim() === "섹션");
    assert.ok(sectionButton); click(sectionButton);
    const section = document.querySelector('[data-bulk-divider]');
    assert.ok(section);
    const cardCount = () => document.querySelectorAll('[data-bulk-question]').length;
    const before = cardCount();
    key(section, "Enter", { isComposing: true });
    key(section, "Enter", { keyCode: 229 });
    key(section, "Enter", { repeat: true });
    assert.equal(cardCount(), before, "composition confirmation and held keys must not create cards");
    const enter = key(section, "Enter");
    assert.equal(enter.defaultPrevented, true);
    assert.equal(cardCount(), before + 1);
    const rows = [...document.querySelectorAll('.bulk-table [data-bulk-empty-delete-row]')];
    const sectionIndex = rows.indexOf(section.closest('[data-bulk-empty-delete-row]'));
    const added = rows[sectionIndex + 1];
    assert.ok(added.querySelector('[data-bulk-question]'), "the inserted row belongs directly below the section");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    assert.equal(document.activeElement.dataset.bulkFocusKind, "content-type");
    assert.equal(document.activeElement.dataset.bulkRowId, added.dataset.bulkEmptyDeleteRow);
  } finally {
    act(() => mountedRoot.unmount()); mountedRoot = null;
    dom.window.HTMLElement.prototype.scrollTo = previousScroll;
    window.localStorage.clear();
  }
});

for (const manual of [false, true]) {
  test(`new bullet insertion uses plain typing before restoring explicit bold: manual=${manual}`, () => {
    const host = document.createElement("div"); document.body.append(host);
    mountedRoot = createRoot(host);
    act(() => mountedRoot.render(React.createElement(FormattedTextEditor, {
      text: "• 청각적으로 듣기", format: "• 청각적으로 듣기", label: "목록 답", placeholder: "", answer: true, showTableButton: false, onChange() {},
    })));
    const editor = host.querySelector('[contenteditable="true"]');
    act(() => editor.focus());
    const originalQuery = document.queryCommandState, originalExec = document.execCommand;
    let typingBold = false;
    const inserted = [];
    document.queryCommandState = command => command === "bold" ? typingBold : false;
    document.execCommand = (command, ui, value) => {
      if (command === "bold") {
        typingBold = !typingBold;
        if (window.getSelection().isCollapsed) return true;
      }
      if (command === "insertText") inserted.push({ text: value, bold: typingBold });
      return originalExec(command, ui, value);
    };
    try {
      const text = editor.firstChild;
      if (manual) caret(text);
      else window.getSelection().setBaseAndExtent(text, text.length - 2, text, text.length);
      key(editor, "b", { code: "KeyB", metaKey: true });
      caret(editor, editor.childNodes.length);
      key(editor, "Enter", { shiftKey: true });
      assert.deepEqual(inserted, [{ text: "\n• ", bold: false }]);
      assert.equal(typingBold, manual, "manual bold applies to the item text, never to the marker");
      assert.equal(editor.textContent, "• 청각적으로 듣기\n• ");
      if (!manual) assert.equal(editor.querySelector("strong").textContent, "듣기");
    } finally { document.queryCommandState = originalQuery; document.execCommand = originalExec; }
  });
}

for (const inputType of ["insertLineBreak", "insertParagraph"]) {
  for (const manual of [false, true]) {
    test(`card ${inputType} resets selected bold but preserves cursor toggles: manual=${manual}`, () => {
      const host = document.createElement("div"); document.body.append(host);
      const changes = [];
      mountedRoot = createRoot(host);
      act(() => mountedRoot.render(React.createElement(FormattedTextEditor, {
        text: "첫문구", format: "첫문구", label: "답", placeholder: "", answer: true, showTableButton: false,
        onChange: (text, format) => changes.push({ text, format }),
      })));
      const editor = host.querySelector('[contenteditable="true"]');
      act(() => editor.focus());
      const originalQuery = document.queryCommandState, originalExec = document.execCommand;
      let typingBold = false;
      document.queryCommandState = command => command === "bold" ? typingBold : false;
      document.execCommand = (command, ui, value) => {
        if (command === "bold") {
          typingBold = !typingBold;
          if (window.getSelection().isCollapsed) return true;
        }
        return originalExec(command, ui, value);
      };
      try {
        const text = editor.firstChild;
        if (manual) caret(text);
        else window.getSelection().setBaseAndExtent(text, 0, text, text.length);
        key(editor, "b", { code: "KeyB", metaKey: true });
        assert.equal(typingBold, true);
        // Model the native break splitting an existing bold run. jsdom cannot
        // perform native typing-style edits; the production input listener must
        // fix the new caret's typing style without unbolding either existing run.
        editor.innerHTML = "<strong>첫</strong><div><strong>문구</strong></div>";
        caret(editor.lastChild.firstChild.firstChild, 0);
        input(editor, { inputType, isComposing: false });
        assert.equal(typingBold, manual);
        assert.equal(editor.querySelectorAll("strong").length, 2);
        assert.equal(editor.textContent, "첫문구");
        assert.ok(changes.at(-1).format.includes("[b]첫[/b]"));
        if (!manual) {
          // A native deletion can inherit bold again; subsequent plain typing
          // must restore the new-line default rather than resurrect bold.
          typingBold = true;
          act(() => editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "새" })));
          assert.equal(typingBold, false);
        }
      } finally { document.queryCommandState = originalQuery; document.execCommand = originalExec; }
    });
  }
}

async function mountRegistration() {
  const host = document.createElement("div"); document.body.append(host);
  let doc = createTable(2, 2);
  doc = editCell(doc, doc.cells[0].id, "말붙임새");
  const state = { saves: [] };
  mountedRoot = createRoot(host);
  await act(async () => mountedRoot.render(React.createElement(TableRegistration, {
    format: encodeTable(doc), onChange: (text, format) => state.saves.push({ text, format }),
  })));
  await act(async () => host.querySelector('[aria-label="표 편집"]').click());
  const editors = doc.cells.map(cell => document.querySelector(`[data-table-editor="${cell.id}"]`));
  assert.ok(editors.every(Boolean));
  click(editors[0].closest('[data-table-cell-id]'), 2);
  assert.equal(document.activeElement, editors[0]);
  return { editors, state };
}

test("table editor keeps one live IME text node through final input and canonical keyword saving", async () => {
  const { editor, state } = mount("[b]가[/b]");
  const node = editor.querySelector("strong").firstChild;
  caret(node);
  composition(editor, "compositionstart");
  node.data = "과학: 타"; caret(node); input(editor, { isComposing: true });
  assert.equal(state.changes.length, 0, "intermediate syllables must not normalize or save");
  composition(editor, "compositionend", "타");
  node.data = "과학: 탐구"; caret(node); input(editor, { inputType: "insertText", isComposing: false });
  await settle();
  assert.equal(editor.querySelector("strong").firstChild, node, "saving must retain the active IME node");
  assert.equal(editor.textContent, "과학: 탐구");
  assert.equal(state.doc.cells[0].format, "[b]과학[/b]: [b]탐구[/b]");
  assert.equal(state.changes.length, 1, "composition commits once after its trailing input");
  act(() => editor.blur()); await settle();
  assert.equal(plainCell(state.doc.cells[0].format), "과학: 탐구");
});

test("table editor ignores unflagged IME Enter/arrows and does not delete an empty structural row", async () => {
  const { editor, state } = mount();
  composition(editor, "compositionstart");
  for (const name of ["Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Backspace"]) key(editor, name);
  assert.deepEqual(state.navigations, []);
  assert.equal(state.deleted, 0);
  assert.equal(document.activeElement, editor);
  composition(editor, "compositionend"); await settle();
});

test("IME Tab commits the original cell before deferred navigation; the next cell receives no old text", async () => {
  const { editor, next, state } = mount("가");
  const node = editor.firstChild; caret(node);
  composition(editor, "compositionstart");
  node.data = "과"; caret(node); input(editor, { isComposing: true });
  const event = key(editor, "Tab");
  assert.equal(event.defaultPrevented, true, "native Tab must not escape to unrelated controls");
  assert.deepEqual(state.navigations, []);
  composition(editor, "compositionend", "과");
  node.data = "과학"; caret(node); input(editor, { inputType: "insertText", isComposing: false });
  await settle();
  assert.deepEqual(state.navigations, [["Tab", false]]);
  assert.equal(document.activeElement, next);
  assert.equal(next.value, "");
  assert.equal(plainCell(state.doc.cells[0].format), "과학");
});

test("a new Korean composition cancels the previous syllable's deferred commit", async () => {
  const { editor, state } = mount("가");
  const node = editor.firstChild; caret(node);
  composition(editor, "compositionstart"); node.data = "과"; input(editor, { isComposing: true });
  composition(editor, "compositionend", "과");
  composition(editor, "compositionstart"); node.data = "과ㅎ"; input(editor, { isComposing: true });
  await settle();
  assert.equal(state.changes.length, 0);
  assert.equal(editor.firstChild, node);
  node.data = "과학"; input(editor, { isComposing: true }); composition(editor, "compositionend", "학");
  await settle();
  assert.equal(plainCell(state.doc.cells[0].format), "과학");
  assert.equal(state.changes.length, 1);
});

test("deleting then retyping after Korean composition preserves the native text node and changes one character", async () => {
  const { editor, state } = mount("[b]과학[/b]");
  const node = editor.querySelector("strong").firstChild; caret(node);
  composition(editor, "compositionstart");
  node.data = "과학: 탐구"; caret(node); input(editor, { isComposing: true });
  composition(editor, "compositionend", "구"); await settle();
  assert.equal(state.doc.cells[0].format, "[b]과학[/b]: [b]탐구[/b]");
  key(editor, "Backspace");
  act(() => editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" })));
  // The browser's native Backspace performs this single mutation. Application
  // handlers must neither replace its node nor replay the deletion afterwards.
  node.data = node.data.slice(0, -1); caret(node); input(editor, { inputType: "deleteContentBackward" });
  assert.equal(editor.querySelector("strong").firstChild, node);
  assert.equal(editor.textContent, "과학: 탐");
  assert.equal(plainCell(state.doc.cells[0].format), "과학: 탐");
  composition(editor, "compositionstart");
  node.data += "구"; caret(node); input(editor, { isComposing: true });
  composition(editor, "compositionend", "구"); await settle();
  assert.equal(editor.querySelector("strong").firstChild, node);
  assert.equal(editor.textContent, "과학: 탐구");
  assert.equal(state.doc.cells[0].format, "[b]과학[/b]: [b]탐구[/b]");
  assert.equal(state.changes.length, 3);
});

test("WebKit's compositionend-before-Enter sequence cannot navigate before final input settles", async () => {
  const { editor, state } = mount("가");
  const node = editor.firstChild; caret(node);
  composition(editor, "compositionstart");
  node.data = "과"; caret(node); input(editor, { isComposing: true });
  composition(editor, "compositionend", "과");
  key(editor, "Enter");
  assert.deepEqual(state.navigations, []);
  assert.equal(document.activeElement, editor);
  node.data = "과학"; caret(node); input(editor, { inputType: "insertText", isComposing: false });
  await settle();
  assert.equal(state.doc.cells[0].format, "과학");
  assert.deepEqual(state.navigations, []);
  key(editor, "Enter");
  assert.deepEqual(state.navigations, [["Enter", false]]);
});

test("unmount cancels a pending composition commit and deferred Tab navigation", async () => {
  const { editor, state } = mount("가");
  composition(editor, "compositionstart");
  editor.firstChild.data = "과학"; input(editor, { isComposing: true });
  key(editor, "Tab");
  composition(editor, "compositionend", "학");
  act(() => mountedRoot.unmount()); mountedRoot = null;
  await settle();
  assert.equal(state.changes.length, 0);
  assert.deepEqual(state.navigations, []);
});

test("Tab pressed during a list item's composition indents after commit instead of changing cells", async () => {
  const { editor, state } = mount("• 부모\n• 자");
  const node = editor.lastChild; caret(node);
  composition(editor, "compositionstart");
  node.data = "• 자식"; caret(node); input(editor, { isComposing: true });
  const event = key(editor, "Tab");
  assert.equal(event.defaultPrevented, true);
  composition(editor, "compositionend", "식");
  input(editor, { inputType: "insertText", isComposing: false });
  await settle();
  assert.deepEqual(state.navigations, []);
  assert.equal(document.activeElement, editor);
  assert.equal(state.doc.cells[0].format, "• 부모\n    • 자식", JSON.stringify({ html: editor.innerHTML, anchor: window.getSelection().anchorNode?.textContent, offset: window.getSelection().anchorOffset }));
  assert.equal(window.getSelection().isCollapsed, true);
});

test("repeated Backspace cannot remove rows and a normal empty-cell Backspace still works", () => {
  const { editor, state } = mount();
  key(editor, "Backspace", { repeat: true });
  assert.equal(state.deleted, 0);
  key(editor, "Backspace");
  assert.equal(state.deleted, 1);
});

test("normal Tab/Shift+Tab navigation and selected bold canonical formatting remain available", () => {
  const { editor, state } = mount("첫째, 둘째");
  const text = editor.firstChild;
  window.getSelection().setBaseAndExtent(text, 0, text, text.length);
  key(editor, "b", { code: "KeyB", metaKey: true });
  assert.equal(state.doc.cells[0].format, "[b]첫째[/b], [b]둘째[/b]");
  assert.equal(window.getSelection().toString(), "첫째, 둘째");
  assert.equal(editor.textContent, "첫째, 둘째");
  key(editor, "Tab");
  act(() => { editor.focus(); caret(editor); });
  key(editor, "Tab", { shiftKey: true });
  assert.deepEqual(state.navigations, [["Tab", false], ["Tab", true]]);
});

test("noncancelable beforeinput leaves list text to the browser instead of applying it twice", () => {
  const { editor, state } = mount("-");
  caret(editor.firstChild);
  const event = new InputEvent("beforeinput", { bubbles: true, cancelable: false, inputType: "insertText", data: " " });
  act(() => editor.dispatchEvent(event));
  assert.equal(editor.textContent, "-");
  assert.equal(state.changes.length, 0);
});

test("external history changes still replace saved content after ordinary input", () => {
  const { editor, state } = mount("처음");
  const node = editor.firstChild;
  node.data = "수정"; caret(node); input(editor, { inputType: "insertText" });
  assert.equal(plainCell(state.doc.cells[0].format), "수정");
  act(() => state.replace(previous => editCell(previous, previous.cells[0].id, "처음")));
  assert.equal(editor.textContent, "처음");
});

for (const [name, destination, extra] of [["Tab", 1, {}], ["Enter", 2, {}]]) {
  test(`real table ${name} navigation clears the old selection before destination focus without a timer`, async () => {
    const { editors } = await mountRegistration();
    const source = editors[0], next = editors[destination];
    const node = source.firstChild;
    caret(node);
    // iOS Korean can emit plain input without any composition event.
    input(source, { inputType: "insertText", data: "새", isComposing: false });
    let sourceWasEditableAtBlur = null, oldRangeAtFocus = null;
    source.addEventListener("blur", () => { sourceWasEditableAtBlur = source.isContentEditable; });
    next.addEventListener("focus", () => { oldRangeAtFocus = source.contains(window.getSelection().anchorNode); });
    key(source, name, extra);
    assert.equal(document.activeElement, next, "the destination must be focused before the key handler returns, without waiting for a timer");
    assert.equal(sourceWasEditableAtBlur, true, "blur must finalize native input before disabling the old editor");
    assert.equal(oldRangeAtFocus, false, "destination focus must not inherit a marked range from the source");
    assert.equal(source.textContent, "말붙임새");
    assert.equal(next.textContent, "");
    assert.equal(source.isConnected, true, "late source events retain their original event target");
    assert.equal(source.isContentEditable, false);
  });
}

test("real table Shift+Tab returns immediately with the previous cell content intact", async () => {
  const { editors } = await mountRegistration();
  key(editors[0], "Tab");
  const source = editors[1], next = editors[0];
  act(() => document.execCommand("insertText", false, "장단꼴"));
  let oldRangeAtFocus = null;
  next.addEventListener("focus", () => { oldRangeAtFocus = source.contains(window.getSelection().anchorNode); });
  key(source, "Tab", { shiftKey: true });
  assert.equal(document.activeElement, next);
  assert.equal(oldRangeAtFocus, false);
  assert.equal(next.textContent, "말붙임새");
  assert.equal(source.textContent, "장단꼴");
});

test("real table pointer editing blurs the source while editable and clears its range before focus", async () => {
  const { editors } = await mountRegistration();
  const source = editors[0], next = editors[3];
  caret(source.firstChild);
  let sourceWasEditableAtBlur = null, oldRangeAtFocus = null;
  source.addEventListener("blur", () => { sourceWasEditableAtBlur = source.isContentEditable; });
  next.addEventListener("focus", () => { oldRangeAtFocus = source.contains(window.getSelection().anchorNode); });
  click(next.closest('[data-table-cell-id]'), 2);
  assert.equal(document.activeElement, next, "pointer activation keeps the same gesture's immediate focus");
  assert.equal(sourceWasEditableAtBlur, true);
  assert.equal(oldRangeAtFocus, false);
  assert.equal(source.textContent, "말붙임새");
  assert.equal(next.textContent, "");
});

test("two ordinary taps retain the existing select-then-edit behavior and immediate focus", async () => {
  const { editors } = await mountRegistration();
  const source = editors[0], next = editors[1], cell = next.closest('[data-table-cell-id]');
  caret(source.firstChild);
  click(cell);
  assert.equal(document.activeElement, cell);
  assert.equal(source.isContentEditable, false);
  assert.equal(next.isContentEditable, false, "the first tap still selects rather than edits");
  assert.equal(source.contains(window.getSelection().anchorNode), false);
  click(cell);
  assert.equal(document.activeElement, next);
  assert.equal(next.isContentEditable, true);
  assert.equal(next.textContent, "");
  assert.equal(source.textContent, "말붙임새");
});

test("late source input stays in its cell and a legitimate matching next syllable is never discarded", async () => {
  const { editors } = await mountRegistration();
  const source = editors[0], next = editors[1];
  key(source, "Tab");
  // Native trailing input targeted to the old host remains source-owned.
  source.firstChild.data = "말붙임새 설명";
  input(source, { inputType: "insertText", data: " 설명", isComposing: false });
  assert.equal(document.activeElement, next);
  assert.equal(source.textContent, "말붙임새 설명");
  assert.equal(next.textContent, "");
  act(() => document.execCommand("insertText", false, "새 장단꼴"));
  assert.equal(next.textContent, "새 장단꼴", "do not remove the next word's matching 새 by text comparison");
  assert.equal(source.textContent, "말붙임새 설명");
});

test("deferred non-list Tab does not refocus the source before moving to a real next editor", async () => {
  const { editors } = await mountRegistration();
  const source = editors[0], next = editors[1];
  let refocuses = 0;
  source.addEventListener("focus", () => { refocuses++; });
  caret(source.firstChild);
  composition(source, "compositionstart");
  key(source, "Tab");
  composition(source, "compositionend", "새");
  input(source, { inputType: "insertText", data: "새", isComposing: false });
  await settle();
  assert.equal(document.activeElement, next);
  assert.equal(refocuses, 0, "a real move must not restart the old editing session");
  assert.equal(source.textContent, "말붙임새");
  assert.equal(next.textContent, "");
});

test("a pointer-chosen cell cancels stale deferred Tab navigation", async () => {
  const { editors } = await mountRegistration();
  const source = editors[0], chosen = editors[3];
  caret(source.firstChild);
  composition(source, "compositionstart");
  key(source, "Tab");
  click(chosen.closest('[data-table-cell-id]'), 2);
  composition(source, "compositionend", "새");
  input(source, { inputType: "insertText", data: "새", isComposing: false });
  await settle();
  assert.equal(document.activeElement, chosen, "an old queued Tab must not override the user's newer pointer destination");
  assert.equal(chosen.textContent, "");
});

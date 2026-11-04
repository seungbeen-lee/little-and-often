type TextControl = HTMLInputElement | HTMLTextAreaElement;
export type TextFocus = { element: HTMLElement; range?: Range; html?: string; start?: number; end?: number };

// Photo tools are pointer-operated helpers; preserve the text editor's caret.
export function captureTextFocus(fallback?: HTMLElement | null): TextFocus | null {
  const isText = (element: Element | null): element is HTMLElement => element instanceof HTMLElement
    && (element.isContentEditable || element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && ["text", "search"].includes(element.type)));
  const active = document.activeElement;
  const element = isText(active) ? active : fallback?.querySelector<HTMLElement>('[contenteditable="true"], textarea');
  if (!element) return null;
  if (element.isContentEditable) {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !element.contains(range.commonAncestorContainer)) return { element };
    const prefix = document.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    prefix.setEnd(range.endContainer, range.endOffset);
    return { element, range: range.cloneRange(), html: element.innerHTML, start, end: prefix.toString().length };
  }
  const control = element as TextControl;
  return { element, start: control.selectionStart ?? undefined, end: control.selectionEnd ?? undefined };
}

export function restoreTextFocus(snapshot: TextFocus | null) {
  if (!snapshot?.element.isConnected) return;
  const { element, range, html, start, end } = snapshot;
  element.focus({ preventScroll: true });
  if (range && html === element.innerHTML && element.contains(range.commonAncestorContainer)) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else if (element.isContentEditable && start !== undefined) {
    // Autosave can replace formatted DOM while the preview is open.
    const boundary = (offset: number): [Node, number] => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      let last: Node | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        last = node;
        if (remaining <= (node.textContent?.length ?? 0)) return [node, remaining];
        remaining -= node.textContent?.length ?? 0;
      }
      return last ? [last, last.textContent?.length ?? 0] : [element, 0];
    };
    const restored = document.createRange();
    restored.setStart(...boundary(start));
    restored.setEnd(...boundary(end ?? start));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(restored);
  } else if (start !== undefined && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    element.setSelectionRange(start, end ?? start);
  }
}

// Finish the old editing context before another table cell receives focus.
// Keep the source node mounted so a trailing native input still belongs to it.
export function releaseTableEditorFocus(editor: HTMLElement): void {
  editor.blur();
  const selection = editor.ownerDocument.getSelection();
  if (selection && ((selection.anchorNode && editor.contains(selection.anchorNode))
    || (selection.focusNode && editor.contains(selection.focusNode)))) {
    selection.removeAllRanges();
  }
}

export function focusTableEditorAtEnd(element: HTMLElement): void {
  const document = element.ownerDocument;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== element && active.hasAttribute("data-table-editor")) {
    releaseTableEditorFocus(active);
  }
  // WebKit must not focus a new editing host with the previous cell's range
  // still selected. Set the destination caret only after focus has transferred.
  const selection = document.getSelection();
  selection?.removeAllRanges();
  element.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// Only card/editor selections carry this marker. External HTML is always pasted
// as text, even when its tags happen to resemble our keyword styling.
const mime = "application/x-little-and-often-card-text";
const marker = "data-little-and-often-copy";

function escapeText(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function styles(element: HTMLElement) {
  return {
    bold: /^(B|STRONG)$/.test(element.tagName) || element.matches("mark.answer-keyword")
      || element.style.fontWeight === "bold" || Number.parseInt(element.style.fontWeight, 10) >= 600,
    italic: /^(I|EM)$/.test(element.tagName) || element.style.fontStyle === "italic",
    underline: element.tagName === "U" || element.style.textDecoration.includes("underline"),
  };
}

function wrap(html: string, element: HTMLElement) {
  const style = styles(element);
  if (style.bold) html = `<b>${html}</b>`;
  if (style.italic) html = `<i>${html}</i>`;
  if (style.underline) html = `<u>${html}</u>`;
  return html;
}

// A positive allowlist: never restore attributes, URLs, images, custom elements,
// CSS or active content from clipboard HTML, including marked internal HTML.
function safeMarkup(parent: Node): string {
  let output = "";
  for (const node of parent.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) { output += escapeText(node.textContent ?? "").replaceAll("\n", "<br>"); continue; }
    if (!(node instanceof HTMLElement) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT)$/.test(node.tagName)) continue;
    if (node.tagName === "BR") { output += "<br>"; continue; }
    const block = /^(P|DIV|LI|TR|H[1-6]|BLOCKQUOTE|PRE)$/.test(node.tagName)
      || node.getAttribute("role") === "cell";
    if (block && output && !output.endsWith("<br>")) output += "<br>";
    output += wrap(safeMarkup(node), node);
    if (block && node.nextSibling && !output.endsWith("<br>")) output += "<br>";
  }
  return output;
}

type CopyEvent = { clipboardData: DataTransfer | null; defaultPrevented: boolean; preventDefault(): void };
export function copyCardSelection(event: CopyEvent, root: HTMLElement) {
  const selection = window.getSelection();
  if (event.defaultPrevented || !event.clipboardData || !selection?.rangeCount || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
  let html = safeMarkup(range.cloneContents());
  // cloneContents omits ancestors when both endpoints are inside one bold run.
  for (let element = range.commonAncestorContainer instanceof HTMLElement
    ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    element && element !== root; element = element.parentElement) html = wrap(html, element);
  if (!html) return false;
  const payload = { version: 1, origin: location.origin, html };
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  event.clipboardData.setData("text/plain", template.content.textContent ?? "");
  // HTML marker is the fallback for browsers that omit custom clipboard types.
  event.clipboardData.setData("text/html", `<span ${marker}="1" data-origin="${escapeText(location.origin)}">${html}</span>`);
  try { event.clipboardData.setData(mime, JSON.stringify(payload)); } catch { /* HTML fallback remains available. */ }
  event.preventDefault();
  return true;
}

export function internalCardMarkup(data: DataTransfer): string | null {
  let html: string | null = null;
  try {
    const payload = JSON.parse(data.getData(mime));
    if (payload?.version === 1 && payload.origin === location.origin && typeof payload.html === "string") html = payload.html;
  } catch { /* External paste or a browser without custom clipboard types. */ }
  const template = document.createElement("template");
  if (html === null) {
    template.innerHTML = data.getData("text/html");
    const source = template.content.querySelector(`[${marker}="1"]`);
    if (!source || source.getAttribute("data-origin") !== location.origin) return null;
    return safeMarkup(source);
  }
  template.innerHTML = html;
  return safeMarkup(template.content);
}

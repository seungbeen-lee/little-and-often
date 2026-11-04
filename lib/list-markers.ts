const formattingTag = /\[\/?(?:b|u|i|accent)\]/g;
const bulletGlyphs = "•●○◦▪▫■□◆◇‣⁃";
const spacedGlyphs = "-‐‑‒–—﹣－·∙⋅・･*";
const markerLine = new RegExp(`^([^\\S\\r\\n]*)([${bulletGlyphs}${spacedGlyphs.replaceAll("-", "\\-")}])([^\\S\\r\\n]*)([^\\r\\n]*)`, "gm");

// Normalize edits/imports, never stored reads. Replacing one glyph with one glyph
// preserves editor selection offsets and doesn't rewrite the active IME DOM.
// OCR can also supply the missing separator before text; it has no active caret.
export function normalizeListMarkers(format: string, options: { spaceAfterMarker?: boolean } = {}) {
  const replacements = new Map<number, string>();
  const text = format.replace(formattingTag, "");
  for (const match of text.matchAll(markerLine)) {
    const [, indentation, marker, gap, item] = match;
    if (!item.trim()) continue;
    const distinctBullet = bulletGlyphs.includes(marker);
    if (!distinctBullet && !gap) continue;
    // Don't turn negative numbers, multiplication or punctuation-only dividers
    // into lists. Numbered lists and punctuation inside words never match here.
    if (!/[\p{L}\p{N}]/u.test(item) || (!distinctBullet && /^[\d０-９]/u.test(item))) continue;
    const offset = match.index! + indentation.length;
    replacements.set(offset, options.spaceAfterMarker && !gap ? "• " : "•");
  }
  if (!replacements.size) return format;
  let offset = 0;
  return format.replace(/\[\/?(?:b|u|i|accent)\]|[\s\S]/g, token => {
    if (/^\[\/?(?:b|u|i|accent)\]$/.test(token)) return token;
    return replacements.get(offset++) ?? token;
  });
}

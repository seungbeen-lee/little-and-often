import { extractBoldKeywords } from "./card-data";
import { isTableFormat, plainCell, readTable, TABLE_PREFIX, tableText } from "./table-card";

export const bulletContentFields = ["question", "questionFormat", "answer", "answerFormat", "memo"] as const;
type Content = Record<(typeof bulletContentFields)[number], string>;

// Change only a spaced list marker at a logical line start. Preserve indentation,
// formatting tags, internal hyphens, minus signs and separator-only lines.
export function replaceLegacyListBullets(format: string) {
  const positions = new Set<number>();
  for (const match of plainCell(format).matchAll(/^[ \t]*-[ \u00a0]+(?=[^\d\s-])/gm)) {
    positions.add(match.index! + match[0].indexOf("-"));
  }
  let offset = 0;
  return format.replace(/\[\/?(?:b|u|i|accent)\]|[\s\S]/g, token => {
    if (/^\[\/?(?:b|u|i|accent)\]$/.test(token)) return token;
    return positions.has(offset++) ? "•" : token;
  });
}

export function planLegacyListBullets(card: Content) {
  const next: Content = { ...card };
  for (const field of ["question", "questionFormat", "memo"] as const) next[field] = replaceLegacyListBullets(card[field]);
  if (isTableFormat(card.answerFormat)) {
    const table = readTable(card.answerFormat);
    if (!table || tableText(table) !== card.answer.trim()) return { reason: "표 내용과 구조가 일치하지 않음" };
    // Work on the original JSON rather than rebuilding IDs, widths or borders.
    const raw = JSON.parse(card.answerFormat.slice(TABLE_PREFIX.length));
    let changed = false;
    for (const cell of raw.cells) {
      const format = replaceLegacyListBullets(cell.format);
      changed ||= format !== cell.format;
      cell.format = format;
    }
    if (changed) {
      next.answerFormat = TABLE_PREFIX + JSON.stringify(raw);
      next.answer = card.answer.replace(card.answer.trim(), tableText(raw));
    }
  } else {
    next.answer = replaceLegacyListBullets(card.answer);
    next.answerFormat = replaceLegacyListBullets(card.answerFormat);
  }
  if (!bulletContentFields.some(field => next[field] !== card[field])) return null;
  if (JSON.stringify(extractBoldKeywords(card.answerFormat)) !== JSON.stringify(extractBoldKeywords(next.answerFormat))) return { reason: "정답 키워드에 포함된 기호는 유지" };
  for (const [text, format] of [["question", "questionFormat"], ["answer", "answerFormat"]] as const) {
    if (next[format] && !isTableFormat(next[format]) && plainCell(next[format]).trim() !== next[text].trim()) return { reason: "원문과 서식이 일치하지 않음" };
  }
  return { next: Object.fromEntries(bulletContentFields.map(field => [field, next[field]])) as Content };
}

// A pre-migration editor can autosave an entire subject from its old snapshot.
// Retain the stored list style while accepting the user's new text and formats.
// Question/answer text and formatting must always move together, including tables.
export function preserveMigratedListBullets(previous: Content, incoming: Content): Content {
  const plan = planLegacyListBullets(incoming);
  if (!plan?.next) return incoming;
  const next = { ...incoming };
  for (const fields of [["question", "questionFormat"], ["answer", "answerFormat"], ["memo"]] as const) {
    if (!/(?:^|[\n\t])[ \t]*•[ \u00a0]/m.test(previous[fields[0]])) continue;
    for (const field of fields) next[field] = plan.next[field];
  }
  return next;
}

export async function bulletFingerprint(card: Content & { keywords: string; updatedAt: string }) {
  const value = JSON.stringify([...bulletContentFields.map(field => card[field]), card.keywords, card.updatedAt]);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

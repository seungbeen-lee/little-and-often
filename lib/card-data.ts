import { normalizeMedia } from "./card-media";
import { normalizeCardContentType } from "./card-content-types";
import { isTableFormat, readTable, encodeTable, editCell, tableText, tableKeywords, splitBoldLists, normalizeBoldBrackets, normalizeBoldBullets, MAX_KEYWORDS } from "./table-card";
import { normalizeListMarkers } from "./list-markers";

const FORMAT_MARKER = /\[\/?(?:u|i|b|accent)\]/g;

export function cleanBoldWhitespace(format: string): string {
  return format.replace(/\[(b|accent)\]([\s\S]*?)\[\/\1\]/g, (_match, kind: string, content: string) => {
    const plain = content.replace(FORMAT_MARKER, "");
    if (!plain.trim()) return content;

    const leading = content.match(/^\s+/)?.[0] ?? "";
    const trailing = content.match(/\s+$/)?.[0] ?? "";
    const coreEnd = trailing ? content.length - trailing.length : content.length;
    const core = content.slice(leading.length, coreEnd);
    if (!core.replace(FORMAT_MARKER, "").trim()) return content;
    return `${leading}[${kind}]${core}[/${kind}]${trailing}`;
  });
}

export function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const keyword = item.trim();
    if (keyword) unique.add(keyword);
  }
  return [...unique];
}

export function parseStoredKeywords(value: string): string[] {
  try {
    return normalizeKeywords(JSON.parse(value));
  } catch {
    return [];
  }
}

export function serializeKeywords(value: unknown): string {
  const keywords=normalizeKeywords(value);
  if(keywords.length>MAX_KEYWORDS)throw new Error(`키워드는 카드 한 장에 최대 ${MAX_KEYWORDS}개까지 저장할 수 있어요. 내용은 잘라서 저장하지 않아요.`);
  return JSON.stringify(keywords);
}

export function normalizeQuestionFormat(value: unknown, question: string): string {
  if (typeof value !== "string") return "";
  const format = normalizeBoldBullets(normalizeBoldBrackets(value.trim().slice(0, 20000)));
  if (!format) return "";

  const formattedText = format.replace(FORMAT_MARKER, "").trim();
  return formattedText === normalizeListMarkers(question.trim()) ? format : "";
}

export function normalizeAnswerFormat(value: unknown, answer: string): string {
  if (typeof value !== "string") return "";
  if (isTableFormat(value)) {
    let table = readTable(value);
    if (!table || tableText(table) !== answer.trim()) throw new Error("표 답안의 구조와 내용을 다시 확인해 주세요.");
    for (const cell of table.cells) {
      const format = normalizeBoldBullets(normalizeBoldBrackets(cell.format));
      if (format !== cell.format) table = editCell(table, cell.id, format);
    }
    return encodeTable(table);
  }
  const format = splitBoldLists(cleanBoldWhitespace(normalizeBoldBullets(normalizeBoldBrackets(value.trim().slice(0, 40000)))));
  if (!format) return "";

  const formattedText = format.replace(FORMAT_MARKER, "").trim();
  return formattedText === normalizeListMarkers(answer.trim()) ? format : "";
}

type CardEditorContentInput = {
  question?: string;
  questionFormat?: string;
  answer?: string;
  answerFormat?: string;
  memo?: string;
};

// Save plain text and formatting as one pair. In particular, table validation
// must use the original answer before converting any cell's list marker.
export function normalizeCardEditorContent(payload: CardEditorContentInput) {
  const rawQuestion = payload.question?.trim() ?? "";
  const rawAnswer = payload.answer?.trim() ?? "";
  const questionFormat = normalizeQuestionFormat(payload.questionFormat, rawQuestion);
  const answerFormat = normalizeAnswerFormat(payload.answerFormat, rawAnswer);
  const table = readTable(answerFormat);
  return {
    question: normalizeListMarkers(rawQuestion),
    questionFormat,
    answer: table ? tableText(table) : normalizeListMarkers(rawAnswer),
    answerFormat,
    memo: normalizeListMarkers(payload.memo?.trim().slice(0, 20000) ?? ""),
  };
}

export function extractBoldKeywords(format: string): string[] {
  if (isTableFormat(format)) return tableKeywords(format).map((item) => item.keyword);
  const normalized = splitBoldLists(cleanBoldWhitespace(format))
    .replaceAll("[accent]", "[b]")
    .replaceAll("[/accent]", "[/b]");
  const keywords: string[] = [];
  const pattern = /\[b\]([\s\S]*?)\[\/b\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(normalized))) {
    const keyword = match[1].replace(FORMAT_MARKER, "").trim();
    if (keyword) keywords.push(keyword);
  }
  return normalizeKeywords(keywords);
}

export function normalizeImportance(value: unknown): 1 | 2 {
  return Number(value) >= 2 ? 2 : 1;
}

export function cardForResponse<T extends { keywords: string; importance: number; contentType: string; media?: string }>(card: T) {
  return {
    ...card,
    contentType: normalizeCardContentType(card.contentType),
    importance: normalizeImportance(card.importance),
    keywords: parseStoredKeywords(card.keywords),
    media: normalizeMedia(card.media),
  };
}

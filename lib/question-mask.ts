import { normalizeKeywordKey } from "./keyword-stats";

// Keep offsets in the original text so formatting and surrounding punctuation
// survive the same spacing/case normalization used by answer matching.
export function questionKeywordRanges(text: string, keywords: readonly string[]) {
  const keys = [...new Set(keywords.map(normalizeKeywordKey).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (!keys.length) return [];

  let normalized = "";
  const offsets: Array<{ start: number; end: number }> = [];
  for (const { segment, index } of new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text)) {
    const key = normalizeKeywordKey(segment);
    normalized += key;
    for (let i = 0; i < key.length; i++) offsets.push({ start: index, end: index + segment.length });
  }
  return [...normalized.matchAll(new RegExp(keys.join("|"), "gu"))].map((match) => ({
    start: offsets[match.index].start,
    end: offsets[match.index + match[0].length - 1].end,
  }));
}

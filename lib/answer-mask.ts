import { normalizeKeywordKey } from "./keyword-stats";
import { questionKeywordRanges } from "./question-mask";

// These are display references, never additional answer slots or recorded keywords.
export function answerKeywordRanges(text: string, keywords: readonly string[]) {
  const sources = new Map(keywords.map((keyword) => [normalizeKeywordKey(keyword), keyword] as const)
    .filter(([key]) => key));
  const aliases = new Map<string, string>();
  for (const [key, keyword] of sources) {
    // A Korean -적 adjective can recur as its noun: 통합적 → 통합되고자.
    // Keep at least two syllables; don't guess arbitrary substrings or synonyms.
    if (/^[가-힣]{2,}적$/u.test(key)) {
      const stem = key.slice(0, -1);
      if (!sources.has(stem)) aliases.set(stem, keyword);
    }
  }
  return questionKeywordRanges(text, [...sources.keys(), ...aliases.keys()]).flatMap((range) => {
    const key = normalizeKeywordKey(text.slice(range.start, range.end));
    const exact = sources.get(key);
    // Don't treat the stem inside another word (e.g. 불통합) as the same concept.
    if (!exact && /[\p{L}\p{M}\p{N}]$/u.test(text.slice(0, range.start))) return [];
    return [{ ...range, keyword: exact ?? aliases.get(key)! }];
  });
}

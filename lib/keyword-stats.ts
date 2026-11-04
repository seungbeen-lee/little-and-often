export type StoredKeywordStat = {
  keywordKey: string;
  keyword: string;
  attempts: number;
  correctCount: number;
  lastAttemptedAt: string | null;
};

export type KeywordInheritanceChoice = {
  sourceKeyword: string;
  targetKeywords: string[];
  selectedTargetKeywords: string[];
};

export function normalizeKeywordKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

function bigrams(value: string) {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

function similarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  let overlap = 0;
  leftPairs.forEach((pair) => {
    if (rightPairs.has(pair)) overlap += 1;
  });
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

function isRelatedKeyword(oldKey: string, newKey: string) {
  if (!oldKey || !newKey) return false;
  if (oldKey.includes(newKey) || newKey.includes(oldKey)) {
    return Math.min(oldKey.length, newKey.length) >= 2;
  }
  return Math.min(oldKey.length, newKey.length) >= 3 && similarity(oldKey, newKey) >= 0.72;
}

function worseStat(left: StoredKeywordStat, right: StoredKeywordStat) {
  const leftRate = left.attempts ? left.correctCount / left.attempts : 1;
  const rightRate = right.attempts ? right.correctCount / right.attempts : 1;
  if (leftRate !== rightRate) return leftRate < rightRate ? left : right;
  return left.attempts >= right.attempts ? left : right;
}

export function inheritKeywordStats(
  newKeywords: string[],
  previous: StoredKeywordStat[],
  choices: KeywordInheritanceChoice[] = []
) {
  const normalizedChoices = choices.flatMap((choice) => {
    const sourceKey = normalizeKeywordKey(choice.sourceKeyword);
    const targetKeys = new Set(choice.targetKeywords.map(normalizeKeywordKey).filter(Boolean));
    const selectedTargetKeys = new Set(choice.selectedTargetKeywords.map(normalizeKeywordKey).filter((key) => targetKeys.has(key)));
    return sourceKey && targetKeys.size >= 2 ? [{ sourceKey, targetKeys, selectedTargetKeys }] : [];
  });

  return newKeywords.flatMap((keyword) => {
    const keywordKey = normalizeKeywordKey(keyword);
    if (!keywordKey) return [];

    const exact = previous.find((item) => item.keywordKey === keywordKey);
    let related = exact
      ? [exact]
      : previous.filter((item) => isRelatedKeyword(item.keywordKey, keywordKey));
    const explicitChoices = normalizedChoices.filter((choice) => choice.targetKeys.has(keywordKey));
    if (!exact && explicitChoices.length) {
      related = related.filter((item) => explicitChoices.some((choice) =>
        choice.sourceKey === item.keywordKey && choice.selectedTargetKeys.has(keywordKey)
      ));
    }
    if (!related.length) return [];

    const inherited = related.reduce(worseStat);
    return [{
      keywordKey,
      keyword,
      attempts: inherited.attempts,
      correctCount: inherited.correctCount,
      lastAttemptedAt: inherited.lastAttemptedAt,
    }];
  });
}

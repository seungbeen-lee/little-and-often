const particles = new Set([
  "은", "는", "이", "가", "을", "를", "의", "에", "에서", "에게", "한테", "께", "께서",
  "에게서", "한테서", "와", "과", "하고", "이랑", "랑", "으로", "로", "으로서", "로서",
  "으로써", "로써", "으로부터", "로부터", "에서부터", "보다", "처럼", "부터", "까지", "마다",
  "만", "도", "조차", "마저", "이나", "나", "이라도", "라도", "밖에", "뿐",
]);
const commonShortStemParticle = /^(?:은|는|이|가|을|를|의|에)$/u;

function hasParticleDifference(expected: string, actual: string) {
  const [longer, shorter] = expected.length >= actual.length ? [expected, actual] : [actual, expected];
  for (const particle of particles) {
    if (!longer.endsWith(particle)) continue;
    const stem = longer.slice(0, -particle.length);
    if (!stem || !shorter.startsWith(stem)) continue;
    const other = shorter.slice(stem.length);
    // Be conservative with one-syllable stems, where compound words often
    // end with the same sound as a particle (e.g. 사과).
    if (stem.length === 1 && !commonShortStemParticle.test(particle) && !commonShortStemParticle.test(other)) continue;
    if (!other || particles.has(other)) return true;
  }
  return false;
}

function words(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/** Detect common particle changes for feedback while keeping exact grading separate. */
export function differsOnlyByKoreanParticles(expected: string, actual: string) {
  if (!/[가-힣]/u.test(expected) && !/[가-힣]/u.test(actual)) return false;
  const expectedWords = words(expected);
  const actualWords = words(actual);
  if (expectedWords.length !== actualWords.length) return false;
  let different = false;
  for (const [index, expectedWord] of expectedWords.entries()) {
    const actualWord = actualWords[index];
    if (expectedWord === actualWord) continue;
    if (!hasParticleDifference(expectedWord, actualWord)) return false;
    different = true;
  }
  return different;
}

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});

test("advances as soon as an exact quiz word arrives and auto-grades the final answer", async () => {
  const { planMatchedQuizAnswer } = await vite.ssrLoadModule("/app/study-app.tsx");

  assert.deepEqual(
    planMatchedQuizAnswer(["인권", "인성"], [], 0, "인권", false),
    { answers: ["인권"], allMatched: false, nextIndex: 1 },
  );
  assert.deepEqual(
    planMatchedQuizAnswer(["인권", "인성"], ["인권"], 1, "인성", false),
    { answers: ["인권", "인성"], allMatched: true, nextIndex: -1 },
  );
});

test("places the caret after existing text whenever quiz navigation focuses an input", async () => {
  const { focusQuizInputAtEnd } = await vite.ssrLoadModule("/app/study-app.tsx");
  for (const value of ["", "한", "소나", "학교 교육", "A😀"]) {
    const calls = [];
    const input = {
      value, isConnected: true, disabled: false,
      focus: (options) => calls.push(["focus", options]),
      setSelectionRange: (...range) => calls.push(["selection", ...range]),
      scrollIntoView: (options) => calls.push(["scroll", options]),
    };
    assert.equal(focusQuizInputAtEnd(input), true);
    assert.deepEqual(calls[0], ["focus", { preventScroll: true }]);
    assert.deepEqual(calls[1], ["selection", value.length, value.length]);
    assert.equal(calls[2][0], "scroll");
  }
  assert.equal(focusQuizInputAtEnd(null), false);
  assert.equal(focusQuizInputAtEnd({ isConnected: false }), false);
  assert.equal(focusQuizInputAtEnd({ isConnected: true, disabled: true }), false);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const cloze = source.slice(source.indexOf("export function QuizCloze("), source.indexOf("export function shouldFocusConnectionContinue("));
  assert.match(cloze, /return focusQuizInputAtEnd\(input\)/);
  assert.doesNotMatch(cloze, /focusAvailableInput\([^\n]*"(?:start|end)"/);
  assert.match(cloze, /event\.key === "Tab"[\s\S]*?event\.shiftKey \? -1 : 1[\s\S]*?if \(focusAvailableInput\(currentIndex \+ direction, direction\)\) event\.preventDefault\(\)/);
});

test("F1 help explains Shift+Tab and prioritizes the foreground editor", async () => {
  const { shortcutHelpContent, foregroundShortcutScreen } = await vite.ssrLoadModule("/components/shortcut-help.tsx");
  assert.match(shortcutHelpContent["study-table"].rows.find(row => row.keys.includes("Shift+Tab")).action, /Shift를 누른 채 Tab/);
  for (const screen of ["home", "cards", "sets", "study-ready", "study-table", "study-write", "quiz-ready", "quiz-table", "card-editor", "bulk-editor", "set-editor", "table-editor", "flow-view"]) {
    assert.ok(shortcutHelpContent[screen].rows.some(row => row.keys === "F1"), `${screen} needs F1 help`);
  }
  const node = className => ({ classList: { contains: name => className === name }, getClientRects: () => [1] });
  assert.equal(foregroundShortcutScreen({ querySelectorAll: () => [node("card-editor-dialog"),node("table-editor-dialog")] }), "table-editor");
  assert.equal(foregroundShortcutScreen({ querySelectorAll: () => [node("set-editor-dialog")] }), "set-editor");
  assert.equal(foregroundShortcutScreen({ querySelectorAll: () => [] }), null);
});

test("offers two hint stages and records only the first hint for each keyword as incorrect", async () => {
  const { firstCharacterHint, initialSoundHint, progressiveQuizHint, unresolvedQuizHintIndex } = await vite.ssrLoadModule("/app/study-app.tsx");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.equal(firstCharacterHint("  언어·수리·디지털 기초소양"), "언");
  assert.equal(initialSoundHint("언어·수리·디지털 기초소양"), "ㅇㅇ·ㅅㄹ·ㄷㅈㅌ ㄱㅊㅅㅇ");
  assert.equal(initialSoundHint("PCK 모형 2022"), "P·· ㅁㅎ 2···");
  assert.equal(progressiveQuizHint("학교 교육", 1), "학");
  assert.equal(progressiveQuizHint("학교 교육", 2), "학ㄱ ㄱㅇ");
  assert.equal(unresolvedQuizHintIndex([{ matched: false }, { matched: false }], 0), 0);
  assert.equal(unresolvedQuizHintIndex([{ matched: false }, { matched: false }], 1), 1);
  assert.equal(unresolvedQuizHintIndex([{ matched: true }, { matched: false }], 0), 1);
  assert.equal(unresolvedQuizHintIndex([{ matched: true }, { matched: true }], 1), -1);

  const hintHandler = source.slice(source.indexOf("  function revealQuizHint("), source.indexOf("  function resolveQuizAttempt("));
  assert.doesNotMatch(hintHandler, /queueReviewResult\(/);
  assert.match(hintHandler, /const isFirstHintForKeyword = !savedCardHints\[keywordIndex\]/);
  assert.match(hintHandler, /if \(isFirstHintForKeyword\) \{[\s\S]*?queueKeywordAttempt\(currentQuizCard, \[\{ keyword, matched: false \}\]\)/);
  assert.match(hintHandler, /같은 키워드의 다음 힌트는 추가되지 않아요/);
  assert.match(source, /quizHintsRef\.current = \{[\s\S]*?\[currentQuizCard\.id\]: nextCardHints/);
  assert.match(source, /const hintKeyword = hintKeywords\[currentIndex\] \|\| evaluation\.expectedKeyword/);
  assert.match(hintHandler, /const keyword = quizHintKeywords\([\s\S]*?\[keywordIndex\]/);
  assert.match(source, /setQuizRetryItems\(/);
  assert.match(source, /quizReviewSequenceRef\.current\.set\(currentQuizCard\.id, queued\.request\)/);
  assert.match(source, /!quizScoredCardIdsRef\.current\.has\(currentQuizCard\.id\)/);
  assert.match(source, /if \(quizAttemptLockRef\.current === attemptKey\) return;/);
  assert.match(source, /quizAttemptLockRef\.current = attemptKey;/);
  assert.match(source, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/);
  assert.match(source, /if \(event\.repeat\) return;/);
  assert.match(source, /aria-keyshortcuts="Control\+Enter Meta\+Enter"/);
  assert.match(source, /힌트 없이 다시 확인/);
  assert.match(css, /\.quiz-answer-heading \.quiz-hint-button\s*\{[^}]*margin-left:\s*auto/);
  assert.match(css, /\.quiz-answer-panel > button\s*\{[^}]*width:\s*100%/);
  assert.doesNotMatch(source, /className="quiz-answer-actions"/);
  assert.match(css, /\.cloze-field-hint\s*\{[^}]*color:\s*#808080/);
  const hintedInputStyle = css.match(/\.cloze-field\.has-hint input\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(hintedInputStyle, /(?:^|;)\s*(?:height|font-size)\s*:/);
});

test("selects the hint from the correct typed prefix and removes only its wrong suffix", async () => {
  const { planQuizHint, remainingQuizHint } = await vite.ssrLoadModule("/app/study-app.tsx");
  for (const answer of ["", "  ", "바다", "ㅅ", "손"]) {
    assert.deepEqual(planQuizHint("소나무", answer), { stage: 1, answer: "" });
  }
  for (const answer of ["소", "소다", "소ㄴ", "소다무"]) {
    assert.deepEqual(planQuizHint("소나무", answer), { stage: 2, answer: "소" });
  }
  assert.deepEqual(planQuizHint("소나무", "소나비"), { stage: 2, answer: "소나" });
  assert.deepEqual(planQuizHint("소나무", "소나무들"), { stage: 2, answer: "소나무" });
  assert.deepEqual(planQuizHint("한국", "한".normalize("NFD")), { stage: 2, answer: "한" });
  assert.deepEqual(planQuizHint("학교 교육", "학교 교사"), { stage: 2, answer: "학교 교" });
  assert.deepEqual(planQuizHint("PCK 모형", "pcq"), { stage: 2, answer: "pc" });
  const first = planQuizHint("소나무", "소다");
  assert.equal(remainingQuizHint("소나무", first.stage, first.answer), "ㄴㅁ");
  assert.deepEqual(planQuizHint("소나무", first.answer), first);
  assert.deepEqual(planQuizHint("소나무", ""), { stage: 1, answer: "" });
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("  function revealQuizHint("), source.indexOf("  function resolveQuizAttempt("));
  assert.match(handler, /next\[keywordIndex\] = hintPlan\.answer/);
  assert.match(handler, /input\?\.setSelectionRange\(hintPlan\.answer\.length, hintPlan\.answer\.length\)/);
  assert.doesNotMatch(handler, /queueReviewResult\(/);
});

test("sizes hinted fields to the full answer using the same input typography", async () => {
  const { QuizCloze } = await vite.ssrLoadModule("/app/study-app.tsx");
  const keyword = "언어·수리·디지털 기초소양";
  const props = {
    card: { id: 103 }, answers: ["언"], checked: false,
    partsOverride: [{ type: "blank", keyword }], onChange() {}, onSubmit() {},
  };
  for (const stage of [1, 2]) {
    const html = renderToStaticMarkup(React.createElement(QuizCloze, {
      ...props, hints: { 0: { stage, keyword, text: "" } },
    }));
    assert.match(html, /class="cloze-field-size" aria-hidden="true">언어·수리·디지털 기초소양<\/span>/);
    assert.match(html, /<input[^>]*value="언"/);
  }
  const plain = renderToStaticMarkup(React.createElement(QuizCloze, props));
  assert.doesNotMatch(plain, /cloze-field-size/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.cloze-field\.has-hint\s*\{[^}]*width: max-content;[^}]*max-width: none/);
  assert.match(css, /\.cloze-field input, \.cloze-field-hint, \.cloze-field-size\s*\{[^}]*font-size: 16px !important/);
});

test("uses the same unordered groups for grading and hints inside dash lists", async () => {
  const { quizAnswerOrder, evaluateQuizAnswers, quizHintKeywords, planQuizHint, planMatchedQuizAnswer } = await vite.ssrLoadModule("/app/study-app.tsx");
  const keywords = ["학생의 관심과 요구", "학교의 실정", "교사의 필요", "계절 및 지역의 특성", "지도 내용의 순서와 비중", "교과 내 또는 교과 간 연계 지도 방법"];
  const parts = keywords.flatMap((keyword, index) => [
    { type: "text", value: index === 0 ? "- " : index === 4 ? "\n- " : ", " },
    { type: "blank", keyword },
  ]);
  const order = quizAnswerOrder(parts);
  assert.deepEqual(order, [0, 0, 0, 0, 1, 1]);
  const reordered = [keywords[2], keywords[3], keywords[0], keywords[1], keywords[5], keywords[4]];
  assert.equal(evaluateQuizAnswers(keywords, reordered, order).every((item) => item.matched), true);
  const partial = ["교사의 틀린말", "계절", "", "", "교과 내", ""];
  const hints = quizHintKeywords(keywords, partial, order);
  assert.equal(hints[0], keywords[2]);
  assert.equal(hints[1], keywords[3]);
  assert.equal(hints[4], keywords[5]);
  assert.deepEqual(planQuizHint(hints[0], partial[0]), { stage: 2, answer: "교사의" });
  assert.equal(new Set(hints).size, keywords.length);
  const crossed = [...reordered];
  [crossed[0], crossed[4]] = [crossed[4], crossed[0]];
  assert.equal(evaluateQuizAnswers(keywords, crossed, order).every((item) => item.matched), false);
  assert.equal(planMatchedQuizAnswer(keywords, [], 0, keywords[5], order), null);
  assert.ok(keywords.slice(0, 4).includes(quizHintKeywords(keywords, ["지도 내용"], order)[0]));
  const last = [...reordered]; last[5] = "";
  assert.equal(planMatchedQuizAnswer(keywords, last, 5, reordered[5], order).allMatched, true);
});

test("shares a leading possessive and trailing phrase across a bare list", async () => {
  const { quizAnswerOrder, evaluateQuizAnswers, quizHintKeywords } = await vite.ssrLoadModule("/app/study-app.tsx");
  const keywords = ["능력", "적성", "진로"];
  for (const tail of ["", "를 고려한다."]) {
    const parts = [{ type: "text", value: "학생의 " }, ...keywords.flatMap((keyword, index) => [
      { type: "blank", keyword }, { type: "text", value: index < 2 ? ", " : tail },
    ])];
    const order = quizAnswerOrder(parts);
    assert.equal(order, true);
    assert.ok(evaluateQuizAnswers(keywords, ["진로", "능력", "적성"], order).every(item => item.matched));
    assert.equal(quizHintKeywords(keywords, ["진", "", ""], order)[0], "진로");
  }
});

test("moral education principles remain one list across mixed single and comma-separated bullets", async () => {
  const { quizAnswerOrder, evaluateQuizAnswers, quizHintKeywords, quizInlineCorrections, quizCorrectionKeywords, quizCorrectionOrder, areQuizCorrectionsComplete } = await vite.ssrLoadModule("/app/study-app.tsx");
  const names = ["정합성", "인지화", "심정화", "행동화", "통합성", "능동적 참여와 토론 학습", "자율적 탐구 학습", "주체적 자각화와 개별화", "구체성과 현실성", "반복과 계속성", "집단 활동", "지적·도덕적 발달 단계 고려", "학교·가정·지역 사회의 연계에 의한 지도"];
  for (const fullKeyword of [true, false]) {
    const keywords = names.map(name => fullKeyword ? `${name}의 원리` : name);
    const parts = keywords.flatMap((keyword, index) => [
      { type: "text", value: index === 0 ? "- " : index === 2 || index === 3 ? ", " : "\n- " },
      { type: "blank", keyword },
      { type: "text", value: fullKeyword ? "" : "의 원리" },
    ]);
    const order = quizAnswerOrder(parts);
    assert.equal(order, true);
    const reordered = [...keywords].reverse();
    assert.ok(evaluateQuizAnswers(keywords, reordered, order).every(item => item.matched));
    const wrong = [...reordered]; wrong[0] = "틀린 말";
    const graded = evaluateQuizAnswers(keywords, wrong, order);
    assert.equal(graded.filter(item => item.matched).length, 12);
    assert.equal(areQuizCorrectionsComplete(quizCorrectionKeywords(graded), [reordered[0]], quizCorrectionOrder(order, graded)), true);
    assert.deepEqual(quizInlineCorrections(parts, graded, wrong).answers, [""]);
    assert.equal(quizHintKeywords(keywords, ["학교", ...reordered.slice(1)], order)[0], reordered[0]);
  }
});

test("single-keyword dash bullets allow reordered answers even without a space after the dash", async () => {
  const { quizAnswerOrder, evaluateQuizAnswers } = await vite.ssrLoadModule("/app/study-app.tsx");
  const keys = ["능력", "적성", "진로"];
  const parts = keys.flatMap((keyword, index) => [{ type: "text", value: index ? "\n-" : "-" }, { type: "blank", keyword }]);
  assert.ok(evaluateQuizAnswers(keys, ["진로", "능력", "적성"], quizAnswerOrder(parts)).every(item => item.matched));
});

test("only exchanges list answers with identical surrounding context", async () => {
  const { quizAnswerOrder, evaluateQuizAnswers, quizHintKeywords, planMatchedQuizAnswer, quizInlineCorrections, quizCorrectionOrder, quizCorrectionKeywords, areQuizCorrectionsComplete } = await vite.ssrLoadModule("/app/study-app.tsx");
  const keywords = ["교과 통합", "가치 통합", "사회 통합"];
  const parts = [
    { type: "blank", keyword: keywords[0] }, { type: "text", value: "의 기능, " },
    { type: "blank", keyword: keywords[1] }, { type: "text", value: "의 기능, 공동체의 " },
    { type: "blank", keyword: keywords[2] }, { type: "text", value: "의 기능" },
  ];
  const order = quizAnswerOrder(parts);
  assert.deepEqual(order, [0, 0, 1]);
  assert.ok(evaluateQuizAnswers(keywords, [keywords[1], keywords[0], keywords[2]], order).every((item) => item.matched));
  const submitted = [keywords[2], keywords[1], keywords[0]];
  const evaluations = evaluateQuizAnswers(keywords, submitted, order);
  assert.deepEqual(evaluations.map((item) => item.matched), [false, true, false]);
  assert.equal(planMatchedQuizAnswer(keywords, [], 0, keywords[2], order), null);
  assert.equal(quizHintKeywords(keywords, ["사회", "", ""], order)[0], keywords[0]);
  assert.equal(quizHintKeywords(keywords, [], order)[2], keywords[2]);
  const correction = quizInlineCorrections(parts, evaluations, submitted);
  assert.deepEqual(correction.answers, ["", ""]);
  assert.ok(correction.parts.some((part) => part.isCorrectAnswer && part.value === keywords[1]));
  const correctionOrder = quizCorrectionOrder(order, evaluations);
  const missed = quizCorrectionKeywords(evaluations);
  assert.equal(areQuizCorrectionsComplete(missed, correction.answers, correctionOrder), false);
  assert.equal(areQuizCorrectionsComplete(missed, [keywords[0], keywords[2]], correctionOrder), true);
  // Suffixes also constrain meaning, and neither whitespace nor a final period changes it.
  const suffixes = [
    { type: "blank", keyword: "학생" }, { type: "text", value: "의 역할, " },
    { type: "blank", keyword: "교사" }, { type: "text", value: "의 역할, " },
    { type: "blank", keyword: "학교" }, { type: "text", value: "의 책임." },
  ];
  assert.deepEqual(quizAnswerOrder(suffixes), [0, 0, 1]);
  const same = structuredClone(parts); same[3].value = " 의 기능, "; same[5].value = "의 기능.";
  assert.equal(quizAnswerOrder(same), true);
});

test("study keywords use inline corrections, guarded progression and per-keyword hints", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const hint = source.slice(source.indexOf("  function revealStudyHint("), source.indexOf("  function gradeStudyKeywords("));
  assert.match(hint, /!hints\[index\] && studySessionMode === "real"/);
  assert.match(hint, /queueKeywordAttempt\(current, \[\{ keyword, matched: false \}\]\)/);
  assert.match(hint, /studyHintsRef.current =/);
  assert.match(source, /if \(studyKeywordMode && \(!answerVisible \|\| !studyCorrectionsComplete\)\) return/);
  assert.match(source, /if \(studyKeywordMode\) gradeStudyKeywordsEvent\(undefined, true\)/);
  assert.match(source, /studyConnectionActive \|\| answered \|\| Boolean\(sectionAnnouncement\)/);
  assert.match(source, /partsOverride=\{studyCorrectionParts\}/);
  assert.match(source, /orderIndependentOverride=\{studyCorrectionOrder\}/);
  assert.match(source, /hints=\{studyHints\}/);
  assert.match(source, /onHint=\{studySessionMode === "real" && studyHintAllowed\(studySessionMode, studyRound\) \? revealStudyHint : undefined\}/);
  assert.match(source, /disabled=\{studyKeywordMode && !studyCorrectionsComplete\}/);
  assert.doesNotMatch(source, /returnToKeywordWriting/);
  // Full writing retains its own comparison/rewrite controls.
  assert.match(source, /onClick=\{returnToWriting\}/);
});

test("study correct fields shrink to text height and daily cards remain visible on mobile", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.study-keyword-mode \.cloze-inline-answer\.is-correct\s*\{[^}]*height: auto;[^}]*min-height: 0;[^}]*line-height: 1\.35/);
  const { DailyStatsReadout } = await vite.ssrLoadModule("/app/study-app.tsx");
  const readout = renderToStaticMarkup(React.createElement(DailyStatsReadout, { count: 12, accuracy: 75 }));
  assert.match(readout, /오늘 학습/);
  assert.match(readout, /12장/);
  assert.match(readout, /정답률/);
  assert.match(readout, /75%/);
  assert.doesNotMatch(readout, /<strong|<svg/);
  assert.match(source, /count=\{dailyStats\?\.learnedCardCount\}/);
  assert.match(source, /activeSubjectDailyStats\?\.learnedCardCount/);
  assert.doesNotMatch(source, /과목별 완주·성공률/);
  assert.doesNotMatch(css, /\.subject-stats-button small\s*\{[^}]*display: none/);
  assert.match(source, /if \(!recordsCardResult\) queueStatisticsOnlyReview/);
  assert.match(source, /if \(!outcome.reviewResult\) queueStatisticsOnlyReview/);
  assert.match(source, /active && \(!review.statisticsOnly \|\| review.learningKind\)/);
});

test("bulk navigation places the caret at the destination text edge", async () => {
  const { placeBulkCaret } = await vite.ssrLoadModule("/app/study-app.tsx");
  const names = ["HTMLInputElement", "HTMLTextAreaElement", "Node", "window", "document"];
  const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  try {
    class Field { value = "교육과정"; setSelectionRange(start, end) { this.selection = [start, end]; } }
    globalThis.HTMLInputElement = Field;
    globalThis.HTMLTextAreaElement = class extends Field {};
    globalThis.Node = { TEXT_NODE: 3 };
    const starts = [];
    globalThis.window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
    globalThis.document = { createRange: () => ({ selectNodeContents() {}, setStart(node, offset) { starts.push([node, offset]); }, collapse() {} }) };
    const input = new Field();
    placeBulkCaret(input, "end"); assert.deepEqual(input.selection, [4, 4]);
    placeBulkCaret(input, "start"); assert.deepEqual(input.selection, [0, 0]);
    const first = { nodeType: 3, textContent: "질문" };
    const last = { nodeType: 3, textContent: "마지막 정답" };
    const rich = { isContentEditable: true, firstChild: { firstChild: first }, lastChild: { lastChild: last } };
    placeBulkCaret(rich, "end"); assert.deepEqual(starts.pop(), [last, 6]);
    placeBulkCaret(rich, "start"); assert.deepEqual(starts.pop(), [first, 0]);
    placeBulkCaret({ isContentEditable: true }, "end");
  } finally {
    names.forEach((name, index) => { if (saved[index]) Object.defineProperty(globalThis, name, saved[index]); else delete globalThis[name]; });
  }
});

test("bulk Enter follows classification, question, answer, memo without intercepting IME or newline", async () => {
  const { bulkEnterNavigation } = await vite.ssrLoadModule("/app/study-app.tsx");
  const saved = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  try {
    globalThis.HTMLElement = class { dataset = { bulkRowId: "card-a" }; };
    const field = new HTMLElement();
    const event = { key: "Enter", target: field, currentTarget: { contains: () => true }, nativeEvent: {} };
    for (const [kind, destination] of [["content-type", "question"], ["question", "answer"], ["answer", "memo"], ["memo", "new-card"], ["divider", "new-card"]]) {
      field.dataset.bulkFocusKind = kind;
      assert.deepEqual(bulkEnterNavigation(event), { rowId: "card-a", destination });
    }
    for (const blocked of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { defaultPrevented: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { key: "Tab" }]) {
      assert.equal(bulkEnterNavigation({ ...event, ...blocked }), null);
    }
    delete field.dataset.bulkFocusKind;
    assert.equal(bulkEnterNavigation(event), null, "nested buttons and table cells retain Enter");
    field.dataset.bulkFocusKind = "divider";
    assert.deepEqual(bulkEnterNavigation(event), { rowId: "card-a", destination: "new-card" }, "section Enter creates a card using the same guarded navigation");
  } finally {
    if (saved) Object.defineProperty(globalThis, "HTMLElement", saved); else delete globalThis.HTMLElement;
  }
});

test("bulk duplicate shortcut resolves the current card or insertion gap without conflicting with Enter", async () => {
  const { bulkDuplicateInsertionIndex } = await vite.ssrLoadModule("/app/study-app.tsx");
  const saved = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  try {
    globalThis.HTMLElement = class {
      dataset = { bulkRowId: "a", bulkFocusKind: "memo" };
      gap = null;
      closest(selector) { return selector === "[data-bulk-gap-index]" ? this.gap : this; }
    };
    const target = new HTMLElement();
    const rows = [{ id: "a", type: "card" }, { id: "section", type: "divider" }, { id: "b", type: "card" }];
    const event = { key: "Enter", metaKey: true, shiftKey: true, nativeEvent: {}, target, currentTarget: { contains: () => true } };
    assert.equal(bulkDuplicateInsertionIndex(event, rows), 1);
    assert.equal(bulkDuplicateInsertionIndex({ ...event, metaKey: false, ctrlKey: true }, rows), 1);
    for (const blocked of [{ metaKey: false }, { shiftKey: false }, { key: "Tab" }, { altKey: true }, { defaultPrevented: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { currentTarget: { contains: () => false } }]) {
      assert.equal(bulkDuplicateInsertionIndex({ ...event, ...blocked }, rows), null);
    }
    target.dataset.bulkRowId = "b";
    assert.equal(bulkDuplicateInsertionIndex(event, rows), 3);
    target.dataset.bulkRowId = "section";
    assert.equal(bulkDuplicateInsertionIndex(event, rows), null);
    target.gap = { dataset: { bulkGapIndex: "1" } };
    assert.equal(bulkDuplicateInsertionIndex(event, rows), 1);
    for (const gap of ["0", "2", "4", "oops"]) {
      target.gap.dataset.bulkGapIndex = gap;
      assert.equal(bulkDuplicateInsertionIndex(event, rows), null);
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, "HTMLElement", saved); else delete globalThis.HTMLElement;
  }
});

test("library subject selection completes without the removed area setter interrupting menu dismissal", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /<Select value=\{librarySubject\} onValueChange=\{setLibrarySubject\}>/);
  assert.doesNotMatch(source, /setLibraryArea/);
});

test("reserves completed keywords and selects the longest available hint prefix", async () => {
  const { quizHintKeywords, quizAnswerOrder, QuizCloze } = await vite.ssrLoadModule("/app/study-app.tsx");
  assert.deepEqual(quizHintKeywords(["한국", "소나무"], ["소다", ""], true), ["소나무", "한국"]);
  assert.deepEqual(quizHintKeywords(["학생", "학교"], ["학", "학교틀림"], true), ["학생", "학교"]);
  assert.deepEqual(quizHintKeywords(["한국", "소나무"], ["소", "소나무"], true), ["한국", "소나무"]);
  assert.deepEqual(quizHintKeywords(["한국", "한국", "소나무"], ["한국", "소", "한"], true), ["한국", "소나무", "한국"]);
  const saved = { 1: { stage: 1, keyword: "한국", text: "한" } };
  assert.deepEqual(quizHintKeywords(["한국", "소나무"], [], true, saved), ["소나무", "한국"]);
  const sentence = [{ type: "blank", keyword: "한국" }, { type: "text", value: "에서 " }, { type: "blank", keyword: "소나무" }];
  assert.equal(quizAnswerOrder(sentence), false);
  assert.deepEqual(quizHintKeywords(["한국", "소나무"], ["소", "한"], false), ["한국", "소나무"]);
  const html = renderToStaticMarkup(React.createElement(QuizCloze, {
    card: { id: 104 }, partsOverride: [{ type: "blank", keyword: "한국" }, { type: "text", value: ", " }, { type: "blank", keyword: "소나무" }],
    answers: ["소"], checked: false, hints: { 0: { stage: 2, keyword: "한국", text: "한ㄱ" } }, onChange() {}, onSubmit() {},
  }));
  assert.match(html, /cloze-field-size[^>]*>소나무<\/span>/);
  assert.match(html, /cloze-hint-entered[^>]*>소<\/span><span>ㄴㅁ<\/span>/);
});

test("preserves dash groups after removing locked correct slots during correction", async () => {
  const { evaluateQuizAnswers, quizCorrectionOrder, quizCorrectionKeywords, areQuizCorrectionsComplete, quizAnswerOrder } = await vite.ssrLoadModule("/app/study-app.tsx");
  const keywords = ["사과", "배", "감", "학교", "교사"];
  const order = [0, 0, 0, 1, 1];
  const evaluations = evaluateQuizAnswers(keywords, ["배", "틀림", "", "", "교사"], order);
  const missed = quizCorrectionKeywords(evaluations);
  const correctionOrder = quizCorrectionOrder(order, evaluations);
  assert.deepEqual(correctionOrder, [0, 0, 1]);
  assert.equal(areQuizCorrectionsComplete(missed, ["감", "사과", "학교"], correctionOrder), true);
  assert.equal(areQuizCorrectionsComplete(missed, ["학교", "사과", "감"], correctionOrder), false);
  const parts = [{ type: "text", value: "- " }, { type: "blank", keyword: "사과" }, { type: "text", value: ", " }, { type: "blank", keyword: "배" }, { type: "text", value: "\n- " }, { type: "blank", keyword: "학업 부담" }, { type: "text", value: "을 " }, { type: "blank", keyword: "적정화" }];
  assert.deepEqual(quizAnswerOrder(parts), [0, 0, 1, 2]);
});

test("scales quiz time by remaining keyword characters plus twenty thinking seconds", async () => {
  const { quizQuestionTimeLimit } = await vite.ssrLoadModule("/app/study-app.tsx");
  assert.equal(quizQuestionTimeLimit(["한국", "소나무"]), 25);
  assert.equal(quizQuestionTimeLimit(["학교 교육", "평생 학습"]), 28);
  assert.equal(quizQuestionTimeLimit(["한국".normalize("NFD")]), 22);
  assert.equal(quizQuestionTimeLimit(["한국", "소나무"], ["한국"]), 23);
  assert.equal(quizQuestionTimeLimit(["한국", "소나무"], ["소나무"], true), 22);
  assert.equal(quizQuestionTimeLimit(["한국", "한국"], ["한국"], true), 22);
  assert.equal(quizQuestionTimeLimit(["가".repeat(100)]), 120);
  assert.equal(quizQuestionTimeLimit(["한국", "소나무"], [], false, true), 45);
  assert.equal(quizQuestionTimeLimit(["한국", "소나무"], ["한국"], false, true), 43);
});

test("excludes recent study, quiz, hint and connection records before weak-keyword selection", async () => {
  const { excludeRecentlyStudiedCards, selectWeakKeywordReview } = await vite.ssrLoadModule("/app/study-app.tsx");
  const now = Date.parse("2026-09-07T14:00:00Z");
  const recent = new Date(now - 60_000).toISOString();
  const cards = [
    { id: 1, keywords: ["학생"], incorrectCount: 999, lastReviewedAt: recent },
    { id: 2, keywords: ["학교"], lastReviewedAt: null },
    { id: 3, keywords: ["교사"], lastReviewedAt: null },
    { id: 4, keywords: ["학습"], lastReviewedAt: null },
    { id: 5, keywords: ["평가"], lastReviewedAt: new Date(now - 30 * 60_000).toISOString() },
    { id: 6, keywords: ["수업"], lastReviewedAt: null },
  ];
  const stats = {
    cardPerformance: { 2: { lastAttemptedAt: recent } },
    keywordPerformance: { 3: [{ keyword: "교사", attempts: 10, incorrect: 9, lastAttemptedAt: recent }] },
    connectionPerformance: { 4: { lastAttemptedAt: recent } },
  };
  const eligible = excludeRecentlyStudiedCards(cards, stats, now);
  assert.deepEqual(eligible.map((card) => card.id), [5, 6]);
  assert.equal(selectWeakKeywordReview(eligible, stats.keywordPerformance), null);
  assert.deepEqual(excludeRecentlyStudiedCards(cards, stats, now + 30 * 60_000).map((card) => card.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(excludeRecentlyStudiedCards(cards.slice(0, 4), stats, now), []);
});

test("flow question edit hit area covers the entire cell without changing row height", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(css, /\.flow-question-cell\s*\{[^}]*position: relative/);
  assert.match(css, /\.flow-question-edit\s*\{[^}]*position: static;[^}]*display: block;[^}]*min-height: 82px/);
  assert.match(css, /\.flow-question-edit::after\s*\{[^}]*content: "";[^}]*position: absolute;[^}]*inset: 0;[^}]*cursor: pointer/);
  assert.match(css, /\.flow-question-edit:focus-visible::after\s*\{[^}]*outline: 2px/);
  assert.match(source, /<button\s+type="button"\s+className="flow-question-edit"[\s\S]*?onClick=\{\(\) => selectingSet \? toggleFlowSetCard\(card\) : openEditFromFlow\(card\)\}/);
  assert.match(source, /className="flow-answer-toggle"[\s\S]*?onClick=\{\(\) => selectingSet \? toggleFlowSetCard\(card\) : toggleFlowAnswer\(card.id\)\}/);
});

test("adds one focused review only for a repeatedly weak keyword", async () => {
  const { keywordReviewParts, selectWeakKeywordReview } = await vite.ssrLoadModule("/app/study-app.tsx");
  const cards = [
    { id: 1, keywords: ["학생의 관심과 요구", "학교의 실정"] },
    { id: 2, keywords: ["교사의 필요"] },
  ];
  const stats = {
    1: [
      { keyword: "학생의 관심과 요구", attempts: 5, correct: 1, incorrect: 4, accuracy: 20, lastAttemptedAt: "2026-09-01T00:00:00Z" },
      { keyword: "학교의 실정", attempts: 3, correct: 2, incorrect: 1, accuracy: 67, lastAttemptedAt: "2026-09-01T00:00:00Z" },
    ],
    2: [
      { keyword: "교사의 필요", attempts: 2, correct: 0, incorrect: 2, accuracy: 0, lastAttemptedAt: "2026-09-01T00:00:00Z" },
    ],
  };

  assert.deepEqual(selectWeakKeywordReview(cards, stats), {
    cardId: 1,
    keyword: "학생의 관심과 요구",
    attempts: 5,
    incorrect: 4,
    errorRate: .8,
    lastAttemptedAt: Date.parse("2026-09-01T00:00:00Z"),
  });
  const card = {
    ...cards[0],
    answer: "학생의 관심과 요구 및 학교의 실정을 고려한다.",
    answerFormat: "[b]학생의 관심과 요구[/b] 및 [b]학교의 실정[/b]을 고려한다.",
  };
  const parts = keywordReviewParts(card, "학생의 관심과 요구");
  assert.deepEqual(parts, [
    { type: "blank", keyword: "학생의 관심과 요구" },
    { type: "text", value: " 및 " },
    { type: "text", value: "학교의 실정", isCorrectAnswer: true },
    { type: "text", value: "을 고려한다." },
  ]);
  const { QuizCloze } = await vite.ssrLoadModule("/app/study-app.tsx");
  const html = renderToStaticMarkup(React.createElement(QuizCloze, {
    card, partsOverride: parts, answers: [], checked: false, onChange() {}, onSubmit() {},
  }));
  assert.equal((html.match(/<input\b/g) ?? []).length, 1);
  assert.match(html, /cloze-inline-answer is-correct is-review-text">학교의 실정<\/span>/);
  assert.match(html, /을 고려한다\./);
  assert.equal(selectWeakKeywordReview([{ id: 1, keywords: ["학교의 실정"] }], stats), null);
  assert.equal(selectWeakKeywordReview(cards, stats, new Set([1])), null);
  // Deferral does not erase the weakness: it can be selected in a later eligible quiz.
  assert.equal(selectWeakKeywordReview(cards, stats, new Set()).cardId, 1);
  const alternative = { ...stats, 2: [{ ...stats[2][0], attempts: 3, incorrect: 3 }] };
  assert.equal(selectWeakKeywordReview(cards, alternative, new Set([2])).cardId, 1);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /selectWeakKeywordReview\(quizEligibleCards, studyStats.keywordPerformance, new Set\(quizMainItems.map\(\(item\) => item.cardId\)\)\)/);
  assert.match(source, /const nextItems: QuizItem\[\] = \[\.\.\.quizStartItems\]/);
  assert.match(source, /const quizStartCount = quizStartItems.length/);
});

test("hint focus restores ancestor and page positions and scrolls only the inner keyword box", async () => {
  const { rememberHintScroll, revealInputInsideCloze, focusQuizInputAtEnd } = await vite.ssrLoadModule("/app/study-app.tsx");
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    const page = { scrollTop: 700, scrollLeft: 0, parentElement: null, isConnected: true };
    const box = { scrollTop: 240, scrollLeft: 15, parentElement: page, isConnected: true, scrollHeight: 900, clientHeight: 200, clientTop: 0, getBoundingClientRect: () => ({ top: 100 }) };
    const pageScrolls = [];
    globalThis.window = { scrollX: 0, scrollY: 700, scrollTo(options) { pageScrolls.push(options); this.scrollX = options.left; this.scrollY = options.top; } };
    const restore = rememberHintScroll(box);
    box.scrollTop = 0; box.scrollLeft = 0; page.scrollTop = 0; window.scrollY = 0;
    restore();
    assert.equal(box.scrollTop, 240); assert.equal(box.scrollLeft, 15); assert.equal(page.scrollTop, 700);
    assert.deepEqual(pageScrolls, [{ left: 0, top: 700, behavior: "instant" }]);
    let rect = { top: 130, bottom: 170 };
    const input = { closest: () => box, getBoundingClientRect: () => rect, isConnected: true, disabled: false, value: "정합", focus() {}, setSelectionRange() {}, scrollIntoView() { throw new Error("Must not scroll outer page"); } };
    revealInputInsideCloze(input);
    assert.equal(box.scrollTop, 240);
    rect = { top: 290, bottom: 330 };
    focusQuizInputAtEnd(input);
    assert.equal(box.scrollTop, 276);
    assert.equal(window.scrollY, 700);
    const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
    for (const [start, end] of [["  function revealStudyHint(", "  function gradeStudyKeywords("], ["  function revealQuizHint(", "  function resolveQuizAttempt("]]) {
      const handler = source.slice(source.indexOf(start), source.indexOf(end));
      assert.match(handler, /rememberHintScroll/); assert.match(handler, /restoreScroll\(\)/);
      assert.doesNotMatch(handler, /scrollIntoView/);
    }
  } finally { if (original) Object.defineProperty(globalThis, "window", original); else delete globalThis.window; }
});

test("study keyword overflow stays inside its box with a separate grading row", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.study-keyword-mode\s*\{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto;[^}]*overflow: hidden/);
  assert.match(css, /\.study-keyword-attempt\s*\{[^}]*min-height: 0;[^}]*overflow: hidden/);
  assert.match(css, /\.study-keyword-mode \.quiz-cloze-copy\s*\{[^}]*height: 100%;[^}]*overflow: auto;[^}]*overscroll-behavior: contain/);
  assert.match(css, /\.study-keyword-mode > button\s*\{[^}]*height: 50px;[^}]*margin-top: 10px/);
});

test("requires every missed keyword to be rewritten without changing the graded attempt", async () => {
  const { quizCorrectionKeywords, areQuizCorrectionsComplete, QuizCloze } = await vite.ssrLoadModule("/app/study-app.tsx");
  const evaluations = [
    { matched: true, expectedKeyword: "한국" },
    { matched: false, expectedKeyword: "소나무" },
    { matched: false, expectedKeyword: "학교 교육" },
  ];
  const original = structuredClone(evaluations);
  const missed = quizCorrectionKeywords(evaluations);
  assert.deepEqual(missed, ["소나무", "학교 교육"]);
  assert.equal(areQuizCorrectionsComplete(missed, []), false);
  assert.equal(areQuizCorrectionsComplete(missed, ["소나무", "학교"]), false);
  assert.equal(areQuizCorrectionsComplete(missed, ["학교교육", "소나무"]), true);
  assert.equal(areQuizCorrectionsComplete(["한국", "한국"], ["한국"]), false);
  assert.equal(areQuizCorrectionsComplete(["한국", "한국"], ["한국", "한국"]), true);
  assert.equal(areQuizCorrectionsComplete([], []), true);
  assert.deepEqual(evaluations, original);
  const props = {
    card: { id: 101 }, partsOverride: missed.map((keyword) => ({ type: "blank", keyword })),
    orderIndependentOverride: true, checked: false,
    inputLabel: "틀린 키워드 다시 쓰기", onChange() {}, onSubmit() {},
  };
  const partial = renderToStaticMarkup(React.createElement(QuizCloze, { ...props, answers: ["소나무"] }));
  assert.equal((partial.match(/<input\b/g) ?? []).length, 1);
  assert.match(partial, /cloze-inline-answer is-correct/);
  const done = renderToStaticMarkup(React.createElement(QuizCloze, { ...props, answers: missed }));
  assert.doesNotMatch(done, /<input\b/);
});

test("stops the quiz clock on review and guards all next-question transitions", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /const timerPaused = mainTab !== "quiz"[^;]*\|\| quizChecked/);
  assert.match(source, /untimed=\{quizConnectionActive \|\| quizChecked\}/);
  assert.match(source, /function nextQuizQuestion\(skipConnection = false\) \{\s*if \(quizPausedRef.current\) return;\s*if \(!quizChecked \|\| !quizCorrectionsComplete\) return;/);
  assert.match(source, /disabled=\{!quizCorrectionsComplete\} onClick=\{\(\) => nextQuizQuestion\(\)\}/);
  assert.match(source, /setQuizSessionRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(source, /key=\{`quiz:[^`]+`\}[\s\S]*?onSubmit=\{\(\) => undefined\}/);
  assert.doesNotMatch(source, /QUIZ_ANSWER_TIME_LIMIT_SECONDS|nextQuizQuestionEvent|정답 확인 1분/);
});

test("desktop review Enter clicks the enabled next button without bypassing corrections", async () => {
  const { handleQuizReviewEnter } = await vite.ssrLoadModule("/app/study-app.tsx");
  let clicks = 0;
  let prevented = 0;
  const button = { isConnected: true, disabled: false, click: () => clicks++ };
  const event = { key: "Enter", preventDefault: () => prevented++, target: null };
  assert.equal(handleQuizReviewEnter(event, button, true), true);
  assert.equal(clicks, 1);
  assert.equal(prevented, 1);
  assert.equal(handleQuizReviewEnter({ ...event, target: { closest: () => button } }, button, true), true);
  assert.equal(clicks, 2);
  for (const change of [{ key: "Escape" }, { isComposing: true }, { keyCode: 229 }, { repeat: true },
    { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true },
    { target: { closest: () => ({ tagName: "INPUT" }) } }]) {
    assert.equal(handleQuizReviewEnter({ ...event, ...change }, button, true), false);
  }
  assert.equal(handleQuizReviewEnter(event, button, false), false);
  assert.equal(handleQuizReviewEnter(event, { ...button, disabled: true }, true), false);
  assert.equal(handleQuizReviewEnter(event, { ...button, isConnected: false }, true), false);
  assert.equal(handleQuizReviewEnter(event, null, true), false);
  assert.equal(clicks, 2);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(mainTab !== "quiz" \|\| !quizChecked \|\| !quizCorrectionsComplete \|\| quizFinished \|\| quizConnectionActive \|\| dialogOpen \|\| bulkOpen\) return;/);
  assert.match(source, /document\.querySelector\('\[role="dialog"\], \[role="alertdialog"\]'\)/);
  assert.match(source, /ref=\{quizNextButtonRef\}[^>]*disabled=\{!quizCorrectionsComplete\} onClick=\{\(\) => nextQuizQuestion\(\)\}/);
  assert.match(source, /window\.removeEventListener\("keydown", handleEnter\)/);
});

test("guided practice treats omitted middle dots like optional spaces", async () => {
  const { remainingCorrectionGuide: guide, matchesGuidedCopy, QuizCloze } = await vite.ssrLoadModule("/app/study-app.tsx");
  const expected="자료 수집·분석 및 해석";
  assert.equal(guide(expected,"자료 수집"),"·분석 및 해석","retain the dot until the next word starts");
  assert.equal(guide(expected,"자료 수집·"),"분석 및 해석");
  assert.equal(guide(expected,"자료수집분"),"석 및 해석","omitting spaces and dot keeps the guide");
  assert.equal(guide(expected,"자료수집부",true),"석 및 해석","same-initial composing syllable stays guided");
  assert.equal(guide(expected,"자료수집주",true),"","wrong initial still hides guide");
  assert.equal(guide(expected,"자료수집분"),"석 및 해석","correcting the typo restores guide");
  assert.equal(guide("수집 · 분석", "수집분"),"석");
  assert.equal(guide(expected,"자료수집분석및해석"),"");
  assert.equal(matchesGuidedCopy(expected,"자료수집분석및해석"),true);
  assert.equal(matchesGuidedCopy(expected,"자료 수집·분석 및 해석"),true);
  assert.equal(matchesGuidedCopy(expected,"자료수집분석및해"),false);
  assert.equal(matchesGuidedCopy("가-나","가나"),false,"other punctuation rules stay unchanged");
  const html=renderToStaticMarkup(React.createElement(QuizCloze,{
    card:{id:103},partsOverride:[{type:"blank",keyword:expected}],answers:["자료수집분"],
    checked:false,guidedPractice:true,onChange(){},onSubmit(){},
  }));
  assert.match(html,/cloze-hint-entered[^>]*>자료수집분<\/span><span>석 및 해석<\/span>/);
});

test("guides follow Korean final-consonant migration without accepting real typos", async () => {
  const { remainingCorrectionGuide: guide, remainingQuizHint: hint, matchesGuidedCopy } = await vite.ssrLoadModule("/app/study-app.tsx");
  for (const composing of [true, false]) {
    assert.equal(guide("자율", "장", composing), "율");
    assert.equal(hint("자율", 2, "장", composing), "ㅇ");
    assert.equal(guide("각 사람", "갃", composing), " 사람", "compound finals may migrate too");
    assert.equal(guide("자율 활동", "자줌", composing), "", "same initial alone cannot justify an incorrect vowel/final");
    assert.equal(guide("매달리기", "매바", composing), "");
    assert.equal(hint("매달리기", 2, "매바", composing), "");
  }
  assert.equal(guide("자율 활동", "자유", true), " 활동");
  assert.equal(guide("방향 전환 달리기", "방향 전호", true), " 달리기");
  assert.equal(matchesGuidedCopy("자율", "장"), false, "visual guidance never accepts unfinished input");
  assert.equal(matchesGuidedCopy("자율", "자율"), true);
});

test("edits original wrong slots in place while keeping correct keywords locked", async () => {
  const { quizInlineCorrections, quizCorrectionKeywords, areQuizCorrectionsComplete, remainingCorrectionGuide, matchesGuidedCopy, QuizCloze } = await vite.ssrLoadModule("/app/study-app.tsx");
  const parts = [
    { type: "text", value: "첫째 " }, { type: "blank", keyword: "한국" },
    { type: "text", value: ", 둘째 " }, { type: "blank", keyword: "한국" },
    { type: "text", value: ", 셋째 " }, { type: "blank", keyword: "소나무" },
  ];
  const evaluations = [
    { matched: false, expectedKeyword: "한국" },
    { matched: true, expectedKeyword: "한국" },
    { matched: false, expectedKeyword: "소나무" },
  ];
  const originalAnswers = ["오답", "한국"];
  const correction = quizInlineCorrections(parts, evaluations, originalAnswers);
  assert.deepEqual(correction.answers, ["", ""]);
  assert.deepEqual(correction.parts[3], { type: "text", value: "한국", isCorrectAnswer: true });
  assert.equal(correction.parts.filter((part) => part.type === "blank").length, 2);
  assert.deepEqual(originalAnswers, ["오답", "한국"]);
  assert.equal(remainingCorrectionGuide("한국", ""), "한국");
  assert.equal(remainingCorrectionGuide("한국", "한"), "국");
  assert.equal(remainingCorrectionGuide("한국", "하"), "");
  assert.equal(remainingCorrectionGuide("한국", "하", true), "국");
  assert.equal(remainingCorrectionGuide("방향 전환 달리기", "방향 전호", true), " 달리기");
  assert.equal(remainingCorrectionGuide("방향 전환 달리기", "방향 전호"), "");
  assert.equal(remainingCorrectionGuide("매달리기", "매다", true), "리기");
  assert.equal(remainingCorrectionGuide("매달리기", "매바", true), "");
  assert.equal(remainingCorrectionGuide("스포츠 유형별 움직임 기술", "스포츠"), " 유형별 움직임 기술");
  assert.equal(remainingCorrectionGuide("스포츠 유형별 움직임 기술", "스포츠 "), "유형별 움직임 기술");
  assert.equal(remainingCorrectionGuide("스포츠 유형별 움직임 기술", "스포츠유"), "형별 움직임 기술");
  assert.equal(remainingCorrectionGuide("버티기나 굽히기", "버티기나"), " 굽히기");
  assert.equal(remainingCorrectionGuide("버티기나 굽히기", "버티기나굽"), "히기");
  assert.equal(matchesGuidedCopy("버티기나 굽히기", "버티기나굽히기"), true);
  assert.equal(matchesGuidedCopy("버티기나 굽히기", "버티기나굽히"), false);
  const props = {
    card: { id: 102 }, partsOverride: correction.parts, orderIndependentOverride: true,
    checked: false, inputLabel: "오답 수정", onChange() {}, onSubmit() {},
  };
  const html = renderToStaticMarkup(React.createElement(QuizCloze, { ...props, answers: correction.answers }));
  assert.match(html, /첫째 .*<input[^>]*value=""[\s\S]*둘째 .*cloze-inline-answer is-correct[^>]*>한국<\/span>[\s\S]*셋째 .*<input/);
  const review = renderToStaticMarkup(React.createElement(QuizCloze, { ...props, answers: correction.answers, correctionMode: true }));
  assert.match(review, /cloze-field-hint[^>]*>.*한국/);
  assert.doesNotMatch(review, /내 답|quiz-answer-keyword/);
  const wrongRewrite = renderToStaticMarkup(React.createElement(QuizCloze, { ...props, answers: ["하", ""], correctionMode: true }));
  assert.doesNotMatch(wrongRewrite, /cloze-field-correction-guide/);
  assert.match(wrongRewrite, /cloze-hint-entered[^>]*>하<\/span><span><\/span>/);
  assert.equal((html.match(/<input\b/g) ?? []).length, 2);
  const missed = quizCorrectionKeywords(evaluations);
  assert.equal(areQuizCorrectionsComplete(missed, ["소나무", "한국"], true), true);
  assert.equal(areQuizCorrectionsComplete(missed, ["소나무", "한국"], false), false);
  assert.equal(areQuizCorrectionsComplete(missed, ["한국", "한국"], true), false);
  const done = renderToStaticMarkup(React.createElement(QuizCloze, { ...props, answers: ["한국", "소나무"] }));
  assert.doesNotMatch(done, /<input\b/);
  assert.equal((done.match(/cloze-inline-answer is-correct/g) ?? []).length, 3);
});

test("replaces ghost hint characters with the actual Korean input without filling the answer", async () => {
  const { remainingQuizHint, QuizCloze } = await vite.ssrLoadModule("/app/study-app.tsx");
  assert.equal(remainingQuizHint("한국", 1, ""), "한");
  assert.equal(remainingQuizHint("한국", 1, "한"), "");
  assert.equal(remainingQuizHint("한국", 2, ""), "한ㄱ");
  assert.equal(remainingQuizHint("한국", 2, "한"), "ㄱ");
  assert.equal(remainingQuizHint("한국", 2, "한국"), "");
  assert.equal(remainingQuizHint("소나무", 2, ""), "소ㄴㅁ");
  assert.equal(remainingQuizHint("소나무", 2, "소"), "ㄴㅁ");
  assert.equal(remainingQuizHint("소나무", 2, "소나"), "ㅁ");
  assert.equal(remainingQuizHint("소나무", 2, "소나무"), "");
  assert.equal(remainingQuizHint("소나무", 2, "소ㄴ"), "ㅁ");
  assert.equal(remainingQuizHint("소나무", 2, "서"), "");
  assert.equal(remainingQuizHint("소나무", 2, "소나무들"), "");
  assert.equal(remainingQuizHint("학교 교육", 2, "학교 "), "ㄱㅇ");
  assert.equal(remainingQuizHint("학교 교육", 2, "학교교"), "ㅇ");
  assert.equal(remainingQuizHint("PCK 모형", 2, "pc"), "· ㅁㅎ");
  assert.equal(remainingQuizHint("방향 전환 달리기", 2, "방향 전호", true), " ㄷㄹㄱ");
  assert.equal(remainingQuizHint("방향 전환 달리기", 2, "방향 전호"), "");
  assert.equal(remainingQuizHint("매달리기", 2, "매다", true), "ㄹㄱ");
  assert.equal(remainingQuizHint("매달리기", 2, "매바", true), "");
  assert.equal(remainingQuizHint("버티기나 굽히기", 2, "버티기나굽"), "ㅎㄱ");

  const html = renderToStaticMarkup(React.createElement(QuizCloze, {
    card: { id: 101 },
    partsOverride: [{ type: "blank", keyword: "소나무" }],
    answers: ["소"],
    hints: { 0: { stage: 2, keyword: "소나무", text: "소ㄴㅁ" } },
    checked: false,
    onChange() {},
    onSubmit() {},
  }));
  assert.match(html, /<input[^>]*value="소"/);
  assert.match(html, /class="cloze-field-hint" aria-hidden="true"><span class="cloze-hint-entered">소<\/span><span>ㄴㅁ<\/span>/);
  assert.doesNotMatch(html, /value="소ㄴㅁ"/);
});

test("counts initial mistakes immediately and hinted answers only after a successful retry", async () => {
  const { quizAttemptOutcome } = await vite.ssrLoadModule("/app/study-app.tsx");
  assert.deepEqual(quizAttemptOutcome("main", true, false), { reviewResult: "correct", retry: false });
  assert.deepEqual(quizAttemptOutcome("main", false, false), { reviewResult: "incorrect", retry: true });
  assert.deepEqual(quizAttemptOutcome("main", true, true), { reviewResult: null, retry: true });
  assert.deepEqual(quizAttemptOutcome("main", false, true), { reviewResult: "incorrect", retry: true });
  for (const hinted of [false, true]) {
    assert.deepEqual(quizAttemptOutcome("retry", true, hinted), { reviewResult: "correct", retry: false });
    assert.deepEqual(quizAttemptOutcome("retry", false, hinted), { reviewResult: null, retry: false });
  }
});

test("recognizes a deliberate right swipe from the mobile left edge", async () => {
  const { isMobileBackSwipeGesture } = await vite.ssrLoadModule("/app/study-app.tsx");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");

  assert.equal(isMobileBackSwipeGesture({ startX: 12, startY: 200, endX: 106, endY: 214, viewportWidth: 390, durationMs: 420 }), true);
  assert.equal(isMobileBackSwipeGesture({ startX: 58, startY: 200, endX: 152, endY: 214, viewportWidth: 390, durationMs: 420 }), false);
  assert.equal(isMobileBackSwipeGesture({ startX: 12, startY: 200, endX: 90, endY: 285, viewportWidth: 390, durationMs: 420 }), false);
  assert.equal(isMobileBackSwipeGesture({ startX: 12, startY: 200, endX: 60, endY: 205, viewportWidth: 390, durationMs: 420 }), false);
  assert.equal(isMobileBackSwipeGesture({ startX: 12, startY: 200, endX: 106, endY: 214, viewportWidth: 390, durationMs: 800 }), false);

  assert.match(source, /window\.history\.pushState\(\{ \.\.\.preservedState, teacherStudyMobileBack: true \}/);
  assert.match(source, /window\.addEventListener\("popstate", handlePopState\)/);
  assert.match(source, /window\.matchMedia\("\(display-mode: standalone\)"\)/);
  assert.match(source, /input, textarea, select, \[contenteditable='true'\]/);
  assert.match(source, /!startsInCardTrack \|\| mobileCardIndex === 0/);
  assert.match(source, /if \(shouldGoBack && mobileHistoryGuardRef\.current\) window\.history\.back\(\)/);
  assert.match(source, /if \(dialogOpen\) \{ cardDialogMobileBackRef\.current\?\.\(\); return; \}/);
  assert.match(source, /if \(bulkOpen\) \{ bulkDialogMobileBackRef\.current\?\.\(\); return; \}/);
});

test("selects every descendant card when a learning-range section is chosen", async () => {
  const { learningCardIdsForSection } = await vite.ssrLoadModule("/app/study-app.tsx");
  const cards = [
    { id: 1, section: "교육과정", subsection: "총론", detailSection: "편성" },
    { id: 2, section: "교육과정", subsection: "총론", detailSection: "운영" },
    { id: 3, section: "교육과정", subsection: "각론", detailSection: "국어" },
    { id: 4, section: "평가", subsection: "원리", detailSection: "타당도" },
  ];

  assert.deepEqual(
    learningCardIdsForSection(cards, 2, "section"),
    [1, 2, 3],
  );
  assert.deepEqual(
    learningCardIdsForSection(cards, 2, "subsection"),
    [1, 2],
  );
  assert.deepEqual(
    learningCardIdsForSection(cards, 2, "detailSection"),
    [2],
  );
});

test("filters learning-range cards by the selected classification", async () => {
  const { learningCardsForContentType } = await vite.ssrLoadModule("/app/study-app.tsx");
  const cards = [
    { id: 1, contentType: "교육과정" },
    { id: 2, contentType: "수업모형" },
    { id: 3, contentType: "각론" },
    { id: 4, contentType: "교육과정" },
  ];

  assert.deepEqual(learningCardsForContentType(cards, "all").map((card) => card.id), [1, 2, 3, 4]);
  assert.deepEqual(learningCardsForContentType(cards, "교육과정").map((card) => card.id), [1, 4]);
  assert.deepEqual(learningCardsForContentType(cards, "수업모형").map((card) => card.id), [2]);
  assert.deepEqual(learningCardsForContentType(cards, "각론").map((card) => card.id), [3]);
});

test("moves a section together with every nested divider and card", async () => {
  const { adjacentBulkDividerId, bulkDragGhostLeft, bulkDropPreviewIndex, bulkDropTargetForGap, bulkSectionPathAtIndex, collapsedBulkRowIds, isBulkDropCenterHit, isBulkDropLineHit, moveBulkRowGroup, visibleBulkRowIds } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = (id) => ({ id, type: "card", cardId: null, contentType: "교육과정", area: "", question: id, questionFormat: "", answer: id, answerFormat: "", memo: "", important: false });
  const rows = [
    { id: "section-a", type: "divider", level: 1, title: "A" },
    { id: "sub-a", type: "divider", level: 2, title: "A-1" },
    card("card-a"),
    { id: "section-b", type: "divider", level: 1, title: "B" },
    card("card-b"),
  ];

  assert.equal(adjacentBulkDividerId(rows, "section-a", "down"), "section-b");
  assert.equal(adjacentBulkDividerId(rows, "section-b", "up"), "section-a");
  assert.equal(bulkDropPreviewIndex(rows, "section-a", "section-b"), rows.length);
  assert.equal(bulkDropPreviewIndex(rows, "section-b", "section-a"), 0);
  assert.equal(bulkDropPreviewIndex(rows, "section-a", "card-a"), null);
  assert.equal(bulkDropTargetForGap(rows, "section-a", rows.length), "card-b");
  assert.equal(bulkDropTargetForGap(rows, "section-b", 0), "section-a");
  assert.equal(bulkDropTargetForGap(rows, "section-a", 4), null);
  assert.equal(isBulkDropLineHit(100, 118), true);
  assert.equal(isBulkDropLineHit(100, 119), false);
  assert.equal(isBulkDropCenterHit(0, 1000, 399), false);
  assert.equal(isBulkDropCenterHit(0, 1000, 400), true);
  assert.equal(isBulkDropCenterHit(0, 1000, 600), true);
  assert.equal(isBulkDropCenterHit(0, 1000, 601), false);
  assert.equal(isBulkDropCenterHit(0, 1000, 1, 1), true);
  assert.equal(isBulkDropCenterHit(0, 1000, 999, 1), true);
  assert.equal(bulkDragGhostLeft(260, 900, 40, 1200), 220);
  assert.equal(bulkDragGhostLeft(1180, 900, 40, 1200), 288);
  assert.equal(bulkDragGhostLeft(10, 900, 40, 1200), 12);
  assert.deepEqual([...collapsedBulkRowIds(rows, new Set(["section-a"]))], ["sub-a", "card-a"]);
  assert.deepEqual([...collapsedBulkRowIds(rows, new Set(["sub-a"]))], ["card-a"]);
  assert.deepEqual(visibleBulkRowIds(rows, new Set(["section-a"])), ["section-a", "section-b", "card-b"]);
  assert.deepEqual(bulkSectionPathAtIndex(rows, 0), { section: "기본", subsection: "", detailSection: "" });
  assert.deepEqual(bulkSectionPathAtIndex(rows, 2), { section: "A", subsection: "A-1", detailSection: "" });
  assert.deepEqual(bulkSectionPathAtIndex(rows, 5), { section: "B", subsection: "", detailSection: "" });
  assert.deepEqual(
    moveBulkRowGroup(rows, "section-a", "section-b").map((row) => row.id),
    ["section-b", "card-b", "section-a", "sub-a", "card-a"],
  );
});

test("duplicates an editor card as a new independent card", async () => {
  const { duplicateBulkCardRow } = await vite.ssrLoadModule("/app/study-app.tsx");
  const image = { id: "12345678-1234-4234-8234-123456789abc", width: 100, align: "center", position: "after", alt: "자료" };
  const source = {
    id: "original", type: "card", cardId: 42, contentType: "교육과정", area: "운동", question: "질문",
    questionFormat: "{}", answer: "답", answerFormat: "{}", memo: "메모",
    media: { question: [image], answer: [], memo: [] }, important: true,
  };
  const copy = duplicateBulkCardRow(source);
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.cardId, null);
  assert.deepEqual({ ...copy, id: source.id, cardId: source.cardId }, source);
  assert.notEqual(copy.media, source.media);
  assert.notEqual(copy.media.question[0], source.media.question[0]);
});

test("uses a mobile position picker and compact card composer instead of the bulk table", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");

  assert.match(source, /className="bulk-desktop-editor"/);
  assert.match(source, /className="mobile-bulk-editor"/);
  assert.match(source, /어디 뒤에 넣을까요\?/);
  assert.match(source, /onClick=\{\(\) => chooseMobileInsertPosition\(rowIndex \+ 1\)\}/);
  assert.match(source, /mobileInsertIndex !== null \? \(/);
  assert.match(source, /무엇을 만들까요\?/);
  assert.match(source, /onClick=\{\(\) => startMobileDraft\("card"\)\}/);
  assert.match(source, /onClick=\{\(\) => startMobileDraft\(1\)\}/);
  assert.match(source, /disabled=\{!mobileInsertHierarchy\.hasSection\}[^>]*onClick=\{\(\) => startMobileDraft\(2\)\}/);
  assert.match(source, /disabled=\{!mobileInsertHierarchy\.hasSubsection\}[^>]*onClick=\{\(\) => startMobileDraft\(3\)\}/);
  assert.match(source, /const next: BulkRow = kind === "card"[\s\S]*?type: "divider", level: kind, title: ""/);
  assert.match(source, /rememberLastCardContentType\(contentType\);[\s\S]*?updateMobileDraft/);
  assert.match(source, /className="mobile-card-location-summary"[\s\S]*?\{selectedSubject\}/);
  assert.match(source, /질문과 답을 모두 입력해 주세요/);
  assert.match(source, /className=\{`mobile-divider-compose-card is-level-\$\{mobileDraftRow\.level\}`\}/);
  assert.match(source, /onClick=\{\(\) => discardMobileDraft\(true\)\}/);
  assert.match(source, /const nextInsertIndex = savedRowIndex \+ 1;[\s\S]*?setMobileDraftRowId\(nextCard\.id\)/);
  assert.match(source, /바로 아래에 새 카드를 이어서 만들어요/);
  assert.match(source, /> 종류 변경<\/Button>/);
  assert.match(source, /> 위치 변경<\/Button>/);
  assert.match(source, /scrollTop: mobilePositionListRef\.current\?\.scrollTop \?\? 0/);
  assert.match(source, /mobileInitialPositionScrolledRef\.current[\s\S]{0,500}list\.scrollTop = list\.scrollHeight/);
  assert.match(source, /data-mobile-position-row-id=\{row\.id\}/);
  assert.match(source, /savedChoice\.offsetTop - \(list\.clientHeight - savedChoice\.offsetHeight\) \/ 2/);
  assert.match(source, /setMobileRecentlySavedRowId\(draftRow\.id\);[\s\S]*?setMobileDraftRowId\(null\)/);
  assert.match(source, /<DialogTitle>\{initial \? "카드 편집" : "새 카드"\}<\/DialogTitle>/);
  assert.match(source, /className="mobile-bulk-copy">카드 추가<\/span>/);
  assert.doesNotMatch(source, /className="mobile-bulk-actions is-location-actions"[\s\S]{0,1000}>보기<\/Button>/);
  assert.doesNotMatch(source, /스제트 수정|새 스제트/);
  assert.match(source, /className="card-meta-panel"/);
  assert.match(css, /\.mobile-bulk-editor, \.mobile-bulk-copy\s*\{[^}]*display:\s*none/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.bulk-desktop-editor,[\s\S]*?display:\s*none !important/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.mobile-bulk-editor\s*\{[^}]*display:\s*grid/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.bulk-dialog-header\s*\{[^}]*padding:\s*4px 0 0 10px/);
  assert.match(css, /\.mobile-position-choice\s*\{[^}]*border-radius:[^}]*background:\s*#fffdf8/);
  assert.match(css, /\.mobile-position-choice\.is-recently-saved\s*\{[^}]*border-color:\s*#4f8b6c[^}]*background:\s*#dff0e5/);
  assert.match(css, /\.mobile-create-kind-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\.mobile-divider-compose-card\.is-level-2\s*\{[^}]*--divider-accent:\s*#b47732/);
  assert.match(css, /\.mobile-divider-compose-card\.is-level-3\s*\{[^}]*--divider-accent:\s*#6b659f/);
  assert.match(css, /\.mobile-bulk-actions\.is-kind-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.card-location-grid, \.card-meta-controls\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
});

test("keeps mobile card-edit paths on separate rows and inserts section cards in card view", async () => {
  const { mobileFlowItemsForCards, mobileFlowJumpItemsFor, mobileFlowTitleFontSize } = await vite.ssrLoadModule("/app/study-app.tsx");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const cards = [
    { id: 1, subject: "국어", section: "교육과정", subsection: "목표", detailSection: "" },
    { id: 2, subject: "국어", section: "교육과정", subsection: "목표", detailSection: "" },
    { id: 3, subject: "국어", section: "교육과정", subsection: "내용", detailSection: "듣기" },
    { id: 4, subject: "국어", section: "교육과정", subsection: "내용", detailSection: "읽기" },
    { id: 5, subject: "국어", section: "교수학습", subsection: "", detailSection: "" },
  ];
  const items = mobileFlowItemsForCards(cards);
  const guides = items.filter((item) => item.type === "section");
  const jumpItems = mobileFlowJumpItemsFor(items);

  assert.deepEqual(items.map((item) => item.type), ["section", "card", "card", "section", "card", "section", "card", "section", "card"]);
  assert.deepEqual(guides.map((item) => item.cardCount), [2, 1, 1, 1]);
  assert.deepEqual(guides.map((item) => item.changeLevel), ["section", "subsection", "detail", "section"]);
  assert.deepEqual(jumpItems.map((item) => `${item.level}:${item.label}`), [
    "section:교육과정",
    "subsection:목표",
    "subsection:내용",
    "detail:듣기",
    "detail:읽기",
    "section:교수학습",
  ]);
  assert.ok(mobileFlowTitleFontSize("짧은 제목", "section") > mobileFlowTitleFontSize("한 줄에 맞춰야 하는 아주 긴 섹션 제목입니다", "section"));
  assert.ok(mobileFlowTitleFontSize("같은 제목", "section") > mobileFlowTitleFontSize("같은 제목", "subsection"));
  assert.ok(mobileFlowTitleFontSize("같은 제목", "subsection") > mobileFlowTitleFontSize("같은 제목", "detail"));
  assert.match(source, /<CardDialog[^>]*subjects=\{subjects\}/);
  assert.match(source, /<FieldLabel>과목<\/FieldLabel>[\s\S]*?<Select value=\{draft\.subject\}/);
  assert.match(source, /<FieldLabel>세부<\/FieldLabel>[\s\S]*?value=\{draft\.detailSection\}/);
  assert.match(source, /<FieldLabel>중요도<\/FieldLabel>[\s\S]{0,500}className=\{`card-importance-toggle\$\{draft\.importance >= 2 \? " is-important" : ""\}`\}/);
  assert.match(source, /<Star fill=\{draft\.importance >= 2 \? "currentColor" : "none"\} \/>/);
  assert.match(source, /mobileFlowItems\.map\(\(item\)/);
  assert.match(source, /className=\{`mobile-flow-importance-toggle\$\{card\.importance >= 2 \? " is-important" : ""\}`\}/);
  assert.match(source, /onClick=\{\(\) => void toggleCardImportance\(card\)\}/);
  assert.match(source, /<span>\{card\.importance >= 2 \? "중요" : "일반"\}<\/span>/);
  assert.match(source, /className=\{`mobile-flow-section-card is-\$\{item\.changeLevel\}`\}/);
  assert.match(source, /\{item\.cardCount\}장의 카드가 이어져요/);
  assert.match(source, /<PopoverTrigger asChild>/);
  assert.match(source, /<Popover modal open=\{mobileCardsJumpOpen\}/);
  assert.match(source, /ref=\{mobileCardsDialogRef\}/);
  assert.match(source, /<PopoverContent container=\{mobileCardsDialogRef\.current\}/);
  assert.match(source, /페이지와 섹션 바로 이동/);
  assert.match(source, /mobileFlowJumpItems\.map\(\(jumpItem\)/);
  assert.doesNotMatch(source, /onClick=\{returnToEditorFromView\}/);
  assert.match(source, /className="mobile-cards-dialog max-w-none border-0 p-4"/);
  assert.match(source, /function openEditFromMobileCards\(card: StudyCard\)[\s\S]{0,700}setMobileEditorTransition\(reduceMotion \? "idle" : "entering"\)[\s\S]{0,100}setDialogOpen\(true\)/);
  assert.doesNotMatch(source, /function openEditFromMobileCards\(card: StudyCard\)[\s\S]{0,700}setMobileCardsOpen\(false\)/);
  assert.match(source, /setMobileEditorTransition\("leaving"\)[\s\S]{0,500}setReturnToMobileCardsAfterEdit\(false\)/);
  assert.match(source, /mobileLayered=\{returnToMobileCardsAfterEdit\}/);
  assert.match(source, /mobileTransition=\{mobileEditorTransition\}/);
  assert.match(source, /overlayClassName=\{mobileLayered \? `mobile-layered-overlay/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.card-location-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.mobile-flow-section-card\s*\{[^}]*min-width:\s*100%[^}]*scroll-snap-align:\s*center/);
  assert.match(css, /\.mobile-flow-importance-toggle\s*\{[^}]*border-radius:\s*999px/);
  assert.match(css, /\.mobile-flow-importance-toggle\.is-important\s*\{[^}]*background:\s*#fff2c9/);
  assert.match(css, /\.card-importance-toggle\s*\{[^}]*cursor:\s*pointer/);
  assert.match(css, /\.card-importance-toggle\.is-important\s*\{[^}]*background:\s*#fff3d8/);
  assert.match(css, /\.mobile-flow-section-card\.is-subsection\s*\{[^}]*--flow-guide-accent:\s*#b47732/);
  assert.match(css, /\.mobile-flow-section-card\.is-detail\s*\{[^}]*--flow-guide-accent:\s*#6b659f/);
  assert.match(css, /\.mobile-flow-section-path\s*\{[^}]*display:\s*grid/);
  assert.match(css, /\.mobile-flow-section-path > div\s*\{[^}]*grid-template-columns:\s*35px minmax\(0, 1fr\)/);
  assert.match(css, /\.mobile-flow-section-path \.is-subsection small\s*\{[^}]*font-size:\s*8px/);
  assert.match(css, /\.mobile-flow-section-path \.is-detail small\s*\{[^}]*font-size:\s*7px/);
  assert.match(css, /\.mobile-flow-section-copy > h2\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.mobile-cards-jump-item\.is-subsection\s*\{[^}]*--jump-level-label-size:\s*8px/);
  assert.match(css, /\.mobile-cards-jump-item\.is-detail\s*\{[^}]*--jump-level-label-size:\s*7px/);
  assert.match(css, /\.mobile-cards-jump-list\s*\{[^}]*overflow-y:\s*scroll[^}]*touch-action:\s*pan-y[^}]*-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /\.mobile-cards-jump-list::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*#91aa9a/);
  assert.doesNotMatch(css, /\.mobile-cards-dialog(?:\.is-under-editor)?\s*\{[^}]*(?:transition|scale):/);
  assert.match(css, /\.mobile-layered-overlay\.is-entering\s*\{[^}]*animation:\s*mobile-layer-overlay-in/);
  assert.match(css, /\.mobile-layered-overlay\.is-leaving\s*\{[^}]*animation:\s*mobile-layer-overlay-out/);
  assert.match(css, /\.card-editor-dialog\.is-mobile-layered\.is-mobile-entering\s*\{[^}]*animation:\s*mobile-editor-enter/);
  assert.match(css, /\.card-editor-dialog\.is-mobile-layered\.is-mobile-leaving\s*\{[^}]*animation:\s*mobile-editor-leave/);
  assert.match(css, /@keyframes mobile-editor-enter\s*\{\s*0%\s*\{\s*opacity:\s*0;\s*\}\s*100%\s*\{\s*opacity:\s*1;\s*\}/);
  assert.match(css, /@keyframes mobile-editor-leave\s*\{\s*0%\s*\{\s*opacity:\s*1;\s*\}\s*100%\s*\{\s*opacity:\s*0;\s*\}/);
  assert.doesNotMatch(css, /@keyframes mobile-editor-(?:enter|leave)\s*\{[^}]*?(?:translate|scale):/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.bulk-dialog-header\s*\{[^}]*padding:\s*4px 0 0 10px/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.bulk-dialog-header\s*\{[^}]*padding-left:\s*14px/);
});

test("bulk undo and redo use the same key positions in Korean and English input modes", async () => {
  const { bulkEditorShortcutKey } = await vite.ssrLoadModule("/app/study-app.tsx");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const handler = source.match(/function handleBulkEditorKeyDown\(event: React.KeyboardEvent<HTMLFormElement>\) \{([\s\S]*?)\n    if \(event.defaultPrevented/)[1];
  let undo = 0, redo = 0;
  const run = new Function("event", "setMode", "preventEnterSubmit", "bulkEditorShortcutKey", "undoRows", "redoRows", "Node", handler);
  const dispatch = (event, ...args) => run({ target: {}, currentTarget: { contains: () => true }, ...event }, ...args, Object);
  for (const modifier of ["ctrlKey", "metaKey"]) {
    for (const key of ["z", "Z", "ㅋ", "Process"]) {
      dispatch({ key, code: "KeyZ", [modifier]: true, preventDefault() {}, stopPropagation() {} }, false, () => {}, bulkEditorShortcutKey, () => undo++, () => redo++);
      dispatch({ key, code: "KeyZ", [modifier]: true, shiftKey: true, preventDefault() {}, stopPropagation() {} }, false, () => {}, bulkEditorShortcutKey, () => undo++, () => redo++);
    }
  }
  assert.equal(undo, 8);
  assert.equal(redo, 8);
  assert.equal(bulkEditorShortcutKey({ key: "ㅛ", code: "KeyY" }), "y");
  assert.equal(bulkEditorShortcutKey({ key: "ㅋ" }), "z");
  assert.equal(bulkEditorShortcutKey({ key: "ArrowLeft" }), "arrowleft");
  for (const event of [{ key: "ㅋ", code: "KeyZ" }, { key: "ㅋ", code: "KeyZ", ctrlKey: true, altKey: true }]) {
    dispatch(event, false, () => {}, bulkEditorShortcutKey, () => undo++, () => redo++);
  }
  assert.equal(undo, 8, "plain Korean typing and Alt combinations must not undo");
  dispatch({ key: "z", metaKey: true, currentTarget: { contains: () => false } }, false, () => {}, bulkEditorShortcutKey, () => undo++, () => redo++);
  assert.equal(undo, 8, "table-dialog portal shortcuts must not also undo the parent card editor");
});

test("bold edits get their own undo step and undo refreshes the focused card editor", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /const formatOnly = current\?\.type === "card" && current\.answer === answer && current\.answerFormat !== answerFormat/);
  assert.match(source, /formatOnly \? null : `answer:\$\{id\}`/);
  assert.match(source, /const formatOnly = current\?\.type === "card" && current\.question === question && current\.questionFormat !== questionFormat/);
  assert.match(source, /formatOnly \? null : `question:\$\{id\}`/);
  assert.match(source, /setHistoryRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(source, /document\.activeElement === editor && !restoringHistory/);
  assert.match(source, /historyRevision=\{historyRevision\}/);
});

test("autosave refreshes editor formatting only from an acknowledged matching edit", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const save = source.slice(source.indexOf("async function saveCardsOnce"), source.indexOf("function persistCards"));
  assert.ok(save.indexOf("setSavedEditorContents") > save.indexOf("const result = await api"));
  assert.match(save, /sourceFormat: submittedRows\.get\(row\.id\)\?\.answerFormat/);
  assert.match(source, /savedContent=\{savedEditorContents\.get\(row\.id\)\?\.answer\}/);
  assert.match(source, /savedContent=\{savedEditorContents\.get\(row\.id\)\?\.question\}/);
  assert.match(source, /savedContent\?\.text === text && savedContent\?\.format === format/);
  assert.match(source, /currentFormat === savedContent\.sourceFormat/);
  assert.match(source, /if \(!editor \|\| composingRef\.current\) return/);
  assert.match(source, /selection\.setBaseAndExtent\(anchor, anchorOffset, focus, focusOffset\)/);
  assert.match(source, /if \(kind === "b" && autoSave\) boldRefreshPendingRef\.current = true/);
  assert.match(source, /setBoldRefreshAt\(Date\.now\(\) \+ 1000\)/);
  assert.match(source, /window\.clearTimeout\(timer\)/);
});

test("offers click-to-move, history, precise drop feedback, scrolling, and folding", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /function undoRows\(\)/);
  assert.match(source, /function redoRows\(\)/);
  assert.match(source, /key === "z"[\s\S]*?event\.shiftKey\) redoRows\(\)/);
  assert.match(source, /key === "y"[\s\S]*?redoRows\(\)/);
  assert.match(source, /aria-label="되돌리기"[^>]*><Undo2 \/><\/Button>/);
  assert.match(source, /aria-label="다시 실행"[^>]*><Redo2 \/><\/Button>/);
  assert.doesNotMatch(source, /<Undo2 \/> 되돌리기|<Redo2 \/> 다시 실행/);
  assert.doesNotMatch(source, /beginSetMode|<FolderHeart \/> 세트 만들기/);
  assert.match(source, /<DialogHeader className="bulk-dialog-header text-left">/);
  assert.match(source, /className="bulk-desktop-copy">카드 편집하기<\/span>/);
  assert.match(source, /<DialogDescription className="bulk-dialog-description">/);
  assert.match(source, /className="bulk-drop-preview-slot"/);
  assert.match(source, /setDragImage\(dragGhost,/);
  assert.match(source, /className = "bulk-drag-ghost-stack"/);
  assert.match(source, /className = "bulk-drag-ghost-card"/);
  assert.match(source, /handle\.closest<HTMLElement>\("\.bulk-table"\)\?\.getBoundingClientRect\(\)/);
  assert.match(source, /dragGhost\.style\.width = `\$\{width\}px`/);
  assert.match(source, /setDragImage\(dragGhost, metrics\.grabOffsetX, 22\)/);
  assert.match(source, /width: pickedDragMetrics\.width/);
  assert.doesNotMatch(source, /window\.innerWidth - 380/);
  assert.match(source, /bulkDropTargetForGap\(rows, draggedRowId, index\)/);
  assert.match(source, /bulkDropPreviewIndex\(rows, draggedRowId, dragTargetRowId\)/);
  assert.match(source, /onDragLeave=\{leaveGapDrop\}/);
  assert.match(source, /function isBulkInsertionTargetHit\(element: HTMLElement, pointerX: number, pointerY: number, activeRatio = \.2\)/);
  assert.match(source, /isBulkDropCenterHit\(bounds\.left, bounds\.width, pointerX, activeRatio\)[\s\S]*?isBulkDropLineHit\(bounds\.top, pointerY\)/);
  assert.match(source, /isBulkInsertionTargetHit\(dropLine, event\.clientX, event\.clientY, 1\)/);
  assert.match(source, /function pickRowWithPointer\(/);
  assert.match(source, /onClick=\{\(event\) => pickRowWithPointer\(event, row\.id\)\}/);
  assert.match(source, /document\.addEventListener\("pointermove", followPickedPointer\)/);
  assert.match(source, /document\.addEventListener\("pointerdown", cancelPickedOnOutsidePress\)/);
  assert.match(source, /onEscapeKeyDown=\{\(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);[\s\S]*?if \(draggedRowId\) \{\s*cancelPickedRowMove\(\);\s*return;/);
  assert.match(source, /onPointerDown=\{\(event\) => placePickedRowAtGap\(event, index\)\}/);
  assert.match(source, /createPortal\([\s\S]*?is-pointer-following/);
  assert.match(source, /container\.scrollTop \+= speed/);
  assert.match(source, /className="divider-collapse-button"/);
  assert.match(source, /aria-expanded=\{!collapsed\}/);
  assert.match(source, /visibleBulkRowIds\(rows, collapsedDividerIds\)/);
  assert.match(source, /data-bulk-focus-kind="divider"/);
  assert.match(source, /data-bulk-focus-kind="content-type"/);
  assert.match(source, /data-bulk-focus-kind="memo"/);
  assert.match(source, /insertDividerAt\(nextInsertionIndex, row\.level, true\)/);
  assert.match(source, /continueFromMemo\(rowIndex, row\.contentType\)/);
  assert.match(source, /insertCardAt\(rowIndex \+ 1, contentType\)/);
  assert.doesNotMatch(source, /function previewRowDrop\(/);
  assert.match(css, /\.bulk-drop-preview-slot\s*\{[^}]*border:\s*2px dashed #5a9a78[^}]*background:\s*#dff0e5/);
  assert.match(css, /\.bulk-insert-row\.is-drop-active \.bulk-insert-actions\s*\{[^}]*min-height:\s*78px/);
  assert.match(css, /\.bulk-insert-row \[data-slot="table-cell"\]\s*\{[^}]*height:\s*0[^}]*line-height:\s*0/);
  assert.match(css, /\.bulk-insert-actions\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.bulk-insert-hit-area\s*\{[^}]*width:\s*min\(100%, 460px\)[^}]*min-height:\s*0/);
  assert.match(css, /\.bulk-insert-row:last-child \[data-slot="table-cell"\]\s*\{[^}]*height:\s*36px/);
  assert.match(css, /\.bulk-insert-row:last-child \.bulk-insert-hit-area::before\s*\{[^}]*top:\s*0/);
  assert.match(css, /\.bulk-insert-row\.is-drop-zone \.bulk-insert-hit-area\s*\{[^}]*width:\s*100%[^}]*min-height:\s*0/);
  assert.match(css, /\.bulk-insert-row\.is-drop-active \.bulk-insert-hit-area\s*\{[^}]*left:\s*0[^}]*width:\s*100%/);
  assert.match(css, /\.bulk-insert-hit-area::before\s*\{[^}]*top:\s*-18px[^}]*height:\s*36px/);
  assert.match(css, /\.bulk-insert-hit-area:hover,[\s\S]*?min-height:\s*36px/);
  assert.match(css, /\.bulk-insert-button-group\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0[^}]*pointer-events:\s*none/);
  assert.match(css, /\.bulk-insert-actions button\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
  assert.doesNotMatch(css, /\.bulk-insert-actions button\s*\{[^}]*box-shadow:\s*0 0 0 3px/);
  assert.match(css, /\.bulk-insert-hit-area:hover \.bulk-insert-button-group,[\s\S]*?opacity:\s*1[^}]*pointer-events:\s*auto/);
  assert.match(css, /\.bulk-dialog-description\s*\{[^}]*font-size:\s*10px/);
  assert.match(css, /\.bulk-dialog-header\s*\{[^}]*gap:\s*2px/);
  assert.match(css, /\.bulk-dialog-title-actions\s*\{[^}]*margin-left:\s*auto/);
  assert.match(css, /\.bulk-history-actions\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.bulk-footer > \[data-slot="button"\]\[data-variant="default"\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*#0a4937[^}]*transform:\s*translateY\(-1px\)/);
  assert.match(css, /\.bulk-footer > \[data-slot="button"\]\[data-variant="outline"\]:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*#3f775d[^}]*background:\s*#d8eadf/);
  assert.match(css, /\.bulk-drag-ghost-card\s*\{[^}]*position:\s*absolute[^}]*top:\s*calc\(var\(--stack-index\) \* 11px\)/);
  assert.match(css, /\.drag-handle\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--primary\)/);
  assert.match(css, /\.divider-collapse-button\s*\{[^}]*border-radius:\s*8px/);
});

test("assigns a distinct stripe class to every classification", async () => {
  const { contentTypeStripeClass } = await vite.ssrLoadModule("/app/study-app.tsx");
  assert.deepEqual(
    ["교육과정", "교과교육론", "각론", "수업모형", "지도서총론"].map(contentTypeStripeClass),
    ["content-type-curriculum", "content-type-theory", "content-type-subject", "content-type-model", "content-type-other"],
  );
});

test("uses classification stripes and restores mistake-count superscripts", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(css, /\.flow-question-cell\s*\{[^}]*box-shadow:\s*inset 5px 0 0 var\(--content-type-stripe/);
  assert.match(css, /\.flow-wrong-sup\s*\{[^}]*vertical-align:\s*super/);
  assert.match(source, /<sup className="flow-wrong-sup"/);
  assert.match(source, /className=\{\`flow-card-row \$\{contentTypeStripeClass\(card\.contentType\)\}[\s\S]*?is-set-selected/);
  assert.match(source, /<ContentTypeStripeLegend \/>/);
});

test("requires two deletion confirmations and offers archive when the item supports it", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");

  assert.match(source, /function FinalDeleteDialog\(/);
  assert.match(source, /마지막으로 한 번 더 확인해 주세요/);
  assert.match(source, /<AlertDialogCancel disabled=\{busy\}>취소<\/AlertDialogCancel>[\s\S]*?>삭제<\/AlertDialogAction>[\s\S]*?<Archive \/> 보관/);
  assert.match(source, /onClick=\{\(\) => setPendingRemoval\(row\)\}><X \/>/);
  assert.match(source, /continueBulkRemoval[\s\S]*?setFinalPendingRemoval\(pendingRemoval\)/);
  assert.match(source, /continueCardDeletion[\s\S]*?setFinalDeleting\(deleting\)/);
  assert.match(source, /continueSetDeletion[\s\S]*?setFinalDeletingSet\(deletingSet\)/);
  assert.match(source, /archivePendingBulkCard[\s\S]*?JSON\.stringify\(\{ archived: true \}\)/);
  assert.match(source, /archiveDeletingCard[\s\S]*?JSON\.stringify\(\{ archived: true \}\)/);
  assert.match(source, /archiveAvailable=\{false\}[\s\S]*?세트는 보관 기능이 없어요/);
  assert.match(css, /\.final-delete-archive-note\s*\{[^}]*background:\s*#edf6ef/);
  assert.match(css, /\.final-delete-actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
  assert.match(css, /\.final-delete-actions \.final-archive-button:not\(:disabled\)\s*\{[^}]*background:\s*#e5f1e8/);
});

test("lets each flow-table answer toggle and each question open its card editor", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /function toggleFlowAnswer\(cardId: number\)/);
  assert.match(source, /className="flow-answer-toggle"[\s\S]*?onClick=\{\(\) => selectingSet \? toggleFlowSetCard\(card\) : toggleFlowAnswer\(card\.id\)\}/);
  assert.match(source, /function openEditFromFlow\(card: StudyCard\)/);
  assert.match(source, /function rememberFlowScrollPosition\(\)/);
  assert.match(source, /flowReturnScrollTopRef\.current = tableShell\.scrollTop/);
  assert.match(source, /tableShell\.scrollTop = flowReturnScrollTopRef\.current/);
  const flowEdit = source.match(/function openEditFromFlow\(card: StudyCard\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(flowEdit, /setDialogOpen\(true\)/);
  assert.doesNotMatch(flowEdit, /setFlowOpen\(false\)/);
  assert.match(source, /function handleBulkDialogOpenChange\(open: boolean\)/);
  assert.match(source, /if \(open \|\| !returnToFlowAfterBulkEdit\) return/);
  assert.match(source, /onOpenChange=\{handleBulkDialogOpenChange\}/);
  assert.match(source, /openFlowTable\(true\)/);
  assert.match(source, /<div ref=\{flowTableScrollRef\} className="flow-table-shell">/);
  assert.match(source, /className="flow-question-edit"[\s\S]*?onClick=\{\(\) => selectingSet \? toggleFlowSetCard\(card\) : openEditFromFlow\(card\)\}/);
  assert.match(source, /onOpenChange=\{handleCardDialogOpenChange\}/);
  assert.match(css, /\.flow-question-edit\s*\{[^}]*cursor:\s*pointer/);
  assert.match(source, /className="mobile-flow-question-edit"[\s\S]*?onClick=\{\(\) => openEditFromMobileCards\(card\)\}/);
  assert.match(source, /setReturnToMobileCardsAfterEdit\(true\)[\s\S]{0,500}setDialogOpen\(true\)/);
  assert.match(css, /\.mobile-flow-question-edit\s*\{[^}]*cursor:\s*pointer/);
});

test("flow table cards span both columns while ordinary cards and click actions stay unchanged", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const tableCss = await readFile(new URL("../components/table-card.css", import.meta.url), "utf8");
  assert.match(source, /const tableCard = !!readTable\(card.answerFormat\)/);
  assert.match(source, /tableCard \? \([\s\S]*?<TableCell colSpan=\{2\} className="flow-table-card-cell">[\s\S]*?className="flow-table-card-title">\{question\}<\/div>[\s\S]*?\{answer\}<\/div>/);
  assert.match(source, /<TableCell className="flow-question-cell">\{question\}<\/TableCell>/);
  assert.match(source, /<TableCell className=\{`flow-answer-cell\$\{answerHidden \? " is-hidden" : ""\}`\}>\{answer\}<\/TableCell>/);
  // The question's full-cell hit area must stop at the title, not cover the table below.
  assert.match(css, /\.flow-table-card-title\s*\{[^}]*position: relative/);
  assert.match(css, /\.flow-table-card-title\s*\{[^}]*box-shadow: inset 5px 0 0 var\(--content-type-stripe/);
  assert.match(source, /<div className="bulk-answer-cell">\s*\{tableCard && <div className="bulk-table-card-title">\{questionEditor\}<\/div>\}/);
  assert.match(css, /\.bulk-table-card-stack \.bulk-table-card-title \.formatted-editor-input\s*\{[^}]*min-height: 0;[^}]*padding: 8px 9px 2px/);
  assert.match(css, /\.flow-table-card-answer \.flow-answer-toggle\s*\{[^}]*min-height: 0/);
  assert.match(tableCss, /\.answer-table-cell\s*\{[^}]*padding:4px 8px;[^}]*min-height:var\(--table-cell-min-height,32px\)/);
  assert.match(tableCss, /\.table-editor-toolbar\s*\{margin-bottom:-8px\}/);
});

test("creates a set directly from selected flow-table cards", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /type FlowSetStep = "idle" \| "select" \| "details"/);
  assert.doesNotMatch(source, /onClick=\{startFlowSetSelection\}/);
  assert.match(source, /onClickCapture=\{\(event\) => selectFlowCard\(event, card\)\}/);
  const body = source.match(/function selectFlowCard\([^\n]*\) \{([\s\S]*?)\n  \}/)[1];
  class TestNode {}
  const select = new Function("event", "card", "viewStudySet", "flowSetStep", "startFlowSetSelection", "toggleFlowSetCard", "isPhotoInteraction", "Node", body);
  for (const [shift, step, expected, photo = false] of [[false, "idle", []], [true, "idle", ["start", 7]], [false, "select", [7]], [true, "idle", [], true], [false, "select", [], true]]) {
    const calls = [];
    select({ target: new TestNode(), currentTarget: { contains: () => true }, shiftKey: shift, preventDefault() {}, stopPropagation() {} }, { id: 7 }, null, step, () => calls.push("start"), card => calls.push(card.id), () => photo, TestNode);
    assert.deepEqual(calls, expected);
  }
  assert.doesNotMatch(source, /flow-view-actions[\s\S]{0,1200}onClick=\{returnToEditorFromView\}/);
  assert.match(source, /function toggleFlowSetCard\(card: StudyCard\)/);
  assert.match(source, /function continueFlowSetDetails\(\)/);
  assert.match(source, /async function createFlowSet\(event: FormEvent\)/);
  assert.match(source, /method: "POST"[\s\S]*?cardIds: selectedFlowSetCards\.map\(\(card\) => card\.id\)/);
  assert.match(source, /<Button type="button" variant="outline" onClick=\{resetFlowSetBuilder\}>취소<\/Button>/);
  assert.match(source, /<Button type="button" disabled=\{flowSetCardIds\.length < 2\} onClick=\{continueFlowSetDetails\}>저장<\/Button>/);
  assert.match(source, /<Button type="button" variant="outline" disabled=\{flowSetSaving\} onClick=\{backToFlowSetSelection\}>뒤로<\/Button>/);
  assert.match(source, /<Button type="submit" disabled=\{flowSetSaving \|\| !flowSetName\.trim\(\)\}>\{flowSetSaving \? "만드는 중…" : "만들기"\}<\/Button>/);
  assert.match(css, /\.flow-card-row\.is-set-selected \.flow-question-cell,[\s\S]*?background:\s*#e5f1e7/);
  assert.match(css, /\.flow-set-footer\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/);
});

test("creates sets from the set tab in card-first steps and keeps every tab heading aligned", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");

  assert.match(source, /const \[setCreateStep, setSetCreateStep\] = useState<"cards" \| "details">\("cards"\)/);
  assert.match(source, /setId \|\| setCreateStep === "cards"[\s\S]*?카드 고르기[\s\S]*?: \([\s\S]*?className="set-create-details-panel"/);
  assert.match(source, /function continueSetCreateDetails\(\)[\s\S]*?setSetCreateStep\("details"\)/);
  assert.match(source, /onClick=\{\(\) => editorSetDetails \? setEditorSetDetails\(false\) : setSetCreateStep\("cards"\)\}>카드 변경<\/Button>/);
  assert.match(source, /onClick=\{\(\) => editorSetDetails \? cancelEditorSetSelection\(\) : onOpenChange\(false\)\}>\{editorSetDetails \? "취소" : "닫기"\}<\/Button>/);
  assert.match(source, /setCreateStep === "cards" \? \([\s\S]*?onClick=\{continueSetCreateDetails\}>다음<\/Button>/);
  assert.doesNotMatch(source, /returnToCardEditor|<ArrowLeft \/> 뒤로가기/);
  assert.match(source, /if \(creatingSet\) onOpenChange\(false\)/);

  assert.equal((source.match(/<TabPageHeading\b/g) ?? []).length, 4);
  assert.doesNotMatch(source.match(/<TabPageHeading\s+eyebrow="[^"]+"\s+title="퀴즈"[\s\S]*?\/>/)[0], /onAdd|addLabel/);
  assert.match(source, /title="어떤 과목을 공부할까요\?"[\s\S]*?addLabel="카드 추가하기"/);
  assert.match(source, /title="비교 세트"[^\n]*set-study-action[^\n]*LibraryBig/);
  assert.match(css, /\.app-tab-heading\s*\{[^}]*min-height:\s*71px/);
  assert.match(css, /\.app-tab-heading > div\s*\{[^}]*grid-template-rows:\s*13px 38px 20px/);
  assert.match(css, /\.app-tab-heading \.heading-add\s*\{[^}]*align-self:\s*end/);
});

test("uses additive learning-range selection and classification stripes", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /rangeSelectedCardIds/);
  assert.match(source, /function toggleStudySection/);
  assert.match(source, /function toggleStudyCard/);
  assert.match(source, /function selectAllVisibleRangeCards/);
  assert.match(source, /onClick=\{selectAllVisibleRangeCards\}>전체 선택<\/Button>/);
  assert.doesNotMatch(source, /rangeStartCardId|rangeEndCardId|selectStudyBoundary|start-order-tags/);
  assert.match(css, /\.start-order-card-row \[data-slot="table-cell"\]:first-child\s*\{[^}]*box-shadow:\s*inset 5px 0 0 var\(--content-type-stripe/);
});

test("shows study shortcuts as a mobile two-by-two grid and one desktop row", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media \(min-width: 760px\)[\s\S]*?\.subject-grid\.subject-important-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.is-study-tab:not\(\.is-studying\) \.subject-important-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
});

test("uses a stable archive mastery and spaced-review schedule", async () => {
  const {
    ARCHIVE_REVIEW_INTERVAL_DAYS,
    AUTO_ARCHIVE_MASTERY_STREAK,
    archiveReviewDueAt,
    isArchiveReviewDue,
    isAutoArchiveReady,
    nextArchiveReviewStage,
    nextReviewProgress,
  } = await vite.ssrLoadModule("/lib/archive-schedule.ts");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const reviewRoute = await readFile(new URL("../app/api/reviews/route.ts", import.meta.url), "utf8");

  assert.equal(AUTO_ARCHIVE_MASTERY_STREAK, 3);
  assert.deepEqual([...ARCHIVE_REVIEW_INTERVAL_DAYS], [1, 3, 7, 14]);
  assert.equal(archiveReviewDueAt("2026-01-01T00:00:00.000Z", 0), "2026-01-02T00:00:00.000Z");
  assert.equal(archiveReviewDueAt("2026-01-01T00:00:00.000Z", 3), "2026-01-15T00:00:00.000Z");
  assert.equal(nextArchiveReviewStage(3), 3);
  assert.equal(isArchiveReviewDue("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", Date.parse("2026-01-02T00:00:00.000Z")), true);
  const reducedToOne = nextReviewProgress({ incorrectCount: 2, correctStreak: 0, masteryStreak: 2 }, "correct");
  const confirmedFinalMistake = nextReviewProgress(reducedToOne, "correct");
  const mistakesCleared = nextReviewProgress(confirmedFinalMistake, "correct");
  assert.deepEqual(reducedToOne, { incorrectCount: 1, correctStreak: 0, masteryStreak: 0 });
  assert.deepEqual(confirmedFinalMistake, { incorrectCount: 1, correctStreak: 1, masteryStreak: 0 });
  assert.deepEqual(mistakesCleared, { incorrectCount: 0, correctStreak: 0, masteryStreak: 0 });
  const masteryOne = nextReviewProgress(mistakesCleared, "correct");
  const masteryTwo = nextReviewProgress(masteryOne, "correct");
  const masteryThree = nextReviewProgress(masteryTwo, "correct");
  assert.equal(isAutoArchiveReady(masteryTwo), false);
  assert.equal(isAutoArchiveReady(masteryThree), true);
  assert.deepEqual(nextReviewProgress(masteryTwo, "incorrect"), { incorrectCount: 1, correctStreak: 0, masteryStreak: 0 });
  assert.match(source, /<TabsTrigger value="archived"><Archive \/> 보관/);
  assert.match(source, /<SelectItem value=\{ARCHIVED_VIEW\}>보관함만<\/SelectItem>/);
  assert.match(source, /function toggleCardArchived\(card: StudyCard\)/);
  assert.match(source, /힌트 없이 키워드 연속 3회, 전체 쓰기 연속 2회를 마치면 자동 보관/);
  assert.match(reviewRoute, /nextReviewProgress\(ownedCard, result\)/);
  assert.match(reviewRoute, /payload.learningKind === "full" && result === "correct" && !ownedCard.archivedAt && !statisticsOnly && completedLearningStages\(learningProgress\)/);
  assert.match(reviewRoute, /result === "incorrect" && ownedCard\.archivedAt/);
});

test("keeps library metadata together and wraps whole section steps", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(css, /\.library-meta-line\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.library-section-path\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.library-section-part\s*\{[^}]*width:\s*max-content/);
  assert.match(source, /<ContentTypeBadge value=\{card\.contentType\} \/>/);
  assert.match(source, /function MistakeCountBadge\(\{ count \}: \{ count: number \}\)/);
  assert.match(source, /<MistakeCountBadge count=\{card\.incorrectCount\} \/>/);
  assert.match(source, /<MistakeCountBadge count=\{detailCard\.incorrectCount\} \/>/);
  assert.match(source, /오답 \{count\}회/);
  assert.match(css, /\.mistake-count-badge\.has-mistakes\s*\{[^}]*background:\s*#fff0ef/);
  assert.doesNotMatch(source, /library-classification-slot/);
  assert.doesNotMatch(source, /<h2 className="question-with-classification"><ContentTypeMarker value=\{card\.contentType\}/);
});

test("shows quiz and study metadata in card-style rows", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /<ContentTypeBadge value=\{currentQuizCard\.contentType\} \/>[\s\S]*?<MistakeCountBadge count=\{currentQuizCard\.incorrectCount\} \/>[\s\S]*?study-importance-button/);
  assert.match(source, /<ContentTypeBadge value=\{current\.contentType\} \/>[\s\S]*?<MistakeCountBadge count=\{current\.incorrectCount\} \/>[\s\S]*?study-importance-button/);
  assert.match(source, /className="card-meta session-card-meta"[\s\S]*?className="session-card-meta-line"[\s\S]*?className="section-path"/);
  assert.match(css, /\.card-meta\.session-card-meta\s*\{[^}]*display:\s*grid/);
  assert.match(css, /\.session-card-meta-line\s*\{[^}]*display:\s*flex/);
});

test("groups study star with connection and edit, and offers editing only on quiz review", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /className="question-card-actions quiz-card-actions"[\s\S]*?toggleCardImportance\(currentQuizCard\)[\s\S]*?\{quizChecked && <Button[^>]*onClick=\{\(\) => openEdit\(currentQuizCard\)\}><Pencil \/> 편집<\/Button>\}/);
  assert.match(source, /className="question-card-actions">\s*<Button[\s\S]*?toggleCardImportance\(current\)[\s\S]*?openSetCreateForCard\(current\)[\s\S]*?openEdit\(current\)/);
  const studyMeta = source.slice(source.indexOf('<SubjectBadge subject={current.subject} subjects={subjects} />'), source.indexOf('onClick={() => openSetCreateForCard(current)}'));
  assert.equal((studyMeta.match(/toggleCardImportance\(current\)/g) ?? []).length, 1);
  assert.doesNotMatch(studyMeta.split('<div className="question-card-actions">')[0], /study-importance-button/);
  assert.match(css, /\.quiz-question-panel \.quiz-card-actions\s*\{[^}]*margin-left:\s*auto/);
  assert.match(css, /\.question-card-actions \.study-importance-button\s*\{[^}]*width:\s*24px[^}]*padding:\s*0/);
});

test("uses only normal and important importance levels", async () => {
  const { normalizeImportance } = await vite.ssrLoadModule("/lib/card-data.ts");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const batchRoute = await readFile(new URL("../app/api/cards/batch/route.ts", import.meta.url), "utf8");
  const organizeRoute = await readFile(new URL("../app/api/cards/organize/route.ts", import.meta.url), "utf8");

  assert.equal(normalizeImportance(undefined), 1);
  assert.equal(normalizeImportance(1), 1);
  assert.equal(normalizeImportance(2), 2);
  assert.equal(normalizeImportance(3), 2);
  assert.doesNotMatch(source, /<FieldLabel>중요도<\/FieldLabel>[\s\S]{0,200}<Select/);
  assert.doesNotMatch(source, /importance:\s*row\.important \? 3 : 1/);
  assert.match(source, /async function toggleCardImportance\(displayedCard: StudyCard\)[\s\S]{0,650}contentType:\s*card\.contentType/);
  assert.doesNotMatch(batchRoute, /\? 3 : 1/);
  assert.doesNotMatch(organizeRoute, /\? 3 : 1/);
});

test("keeps card content classification within the five input choices", async () => {
  const { CARD_CONTENT_TYPES, DEFAULT_CARD_CONTENT_TYPE, normalizeCardContentType } = await vite.ssrLoadModule("/lib/card-content-types.ts");

  assert.deepEqual(CARD_CONTENT_TYPES, ["교육과정", "교과교육론", "각론", "수업모형", "지도서총론"]);
  assert.equal(DEFAULT_CARD_CONTENT_TYPE, "교육과정");
  assert.equal(normalizeCardContentType("수업모형"), "수업모형");
  assert.equal(normalizeCardContentType("없는 분류"), "지도서총론");
  assert.equal(normalizeCardContentType("교육론"), "교과교육론");
  assert.equal(normalizeCardContentType("기타"), "지도서총론");
  for (const contentType of CARD_CONTENT_TYPES) {
    assert.equal(normalizeCardContentType(contentType), contentType);
  }
});

test("existing cards expose renamed classifications without changing stored content or history", async () => {
  const { cardForResponse } = await vite.ssrLoadModule("/lib/card-data.ts");
  for (const [oldType, newType] of [["교육론", "교과교육론"], ["기타", "지도서총론"]]) {
    const stored = { id: 1, contentType: oldType, importance: 1, keywords: '["키워드"]',
      question: "질문", answer: "답", memo: "메모", correctCount: 7, incorrectCount: 3,
      archivedAt: "2026-10-01T00:00:00.000Z" };
    const response = cardForResponse(stored);
    assert.equal(response.contentType, newType);
    assert.equal(stored.contentType, oldType);
    for (const key of ["id", "question", "answer", "memo", "correctCount", "incorrectCount", "archivedAt"]) {
      assert.equal(response[key], stored[key]);
    }
  }
});

test("finds repeated answer keywords in questions with matching spacing and Unicode normalization", async () => {
  const { questionKeywordRanges } = await vite.ssrLoadModule("/lib/question-mask.ts");
  const text = "무수한 '지금'과 지금은 안전 · 지속가능 사회를 만든다.";
  assert.deepEqual(questionKeywordRanges(text, ["지금", "지금", "안전·지속가능", "", "·"])
    .map(({ start, end }) => text.slice(start, end)), ["지금", "지금", "안전 · 지속가능"]);
  const decomposed = "지금".normalize("NFD");
  assert.deepEqual(questionKeywordRanges(decomposed, ["지금"]), [{ start: 0, end: decomposed.length }]);
  assert.deepEqual(questionKeywordRanges("깊이 있는 학습과 학습", ["학습", "깊이있는학습"]), [{ start: 0, end: 8 }, { start: 10, end: 12 }]);
  assert.deepEqual(questionKeywordRanges("다른 질문", ["정답"]), []);
});

test("links unbolded answer repeats including Korean -적 stems without inventing partial-word matches", async () => {
  const { answerKeywordRanges } = await vite.ssrLoadModule("/lib/answer-mask.ts");
  const text = "통합되고자 한다. 통합적 동기와 도구 사용, 불통합, 안전 · 지속가능, NOW";
  const ranges = answerKeywordRanges(text, ["통합적", "도구적", "안전·지속가능", "now"]);
  assert.deepEqual(ranges.map(({ start, end, keyword }) => [text.slice(start, end), keyword]), [
    ["통합", "통합적"], ["통합적", "통합적"], ["도구", "도구적"], ["안전 · 지속가능", "안전·지속가능"], ["NOW", "now"],
  ]);
  assert.deepEqual(answerKeywordRanges("지도를 사용한다", ["지적"]), [], "one-syllable stems are too ambiguous");
  assert.equal(answerKeywordRanges("통합된다", ["통합적", "통합"])[0].keyword, "통합", "an explicit exact keyword takes precedence");
  const decomposed = "통합".normalize("NFD");
  assert.deepEqual(answerKeywordRanges(decomposed, ["통합적"]), [{ start: 0, end: decomposed.length, keyword: "통합적" }]);
});

test("answer explanation blanks follow correct answers and corrections without becoming inputs or changing source data", async () => {
  const { QuizCloze, quizInlineCorrections, evaluateQuizAnswers, keywordReviewParts } = await vite.ssrLoadModule("/app/study-app.tsx");
  const { cellParts, createTable, editCell, encodeTable, tableParts, tableText } = await vite.ssrLoadModule("/lib/table-card.ts");
  const format = "- [b]통합적[/b] 동기 : 목표 문화에 통합되고자 하는 동기, 다시 통합적 동기\n- [b]도구적[/b] 동기 : 도구를 활용";
  let table = createTable(1, 2);
  table = editCell(table, table.cells[0].id, format.split("\n")[0]);
  table = editCell(table, table.cells[1].id, format.split("\n")[1]);
  for (const isTable of [false, true]) {
    const card = { id: -900, answer: isTable ? tableText(table) : format.replace(/\[\/?b\]/g, ""), answerFormat: isTable ? encodeTable(table) : format, keywords: ["통합적", "도구적"] };
    const snapshot = JSON.stringify(card);
    const parts = isTable ? tableParts(table) : cellParts(format);
    const render = (answers, extra = {}) => renderToStaticMarkup(React.createElement(QuizCloze, {
      card, answers, checked: false, orderIndependentOverride: false, onChange() {}, onSubmit() {}, ...extra,
    }));
    const masks = html => [...html.matchAll(/<span[^>]*answer-keyword-blank[^>]*>[\s\S]*?<\/span>/g)].map(m => m[0]);
    const initial = render([]);
    assert.equal((initial.match(/<input\b/g) ?? []).length, 2);
    assert.equal(masks(initial).length, 3);
    assert.ok(masks(initial).every(mask => mask.includes("is-missed") && mask.endsWith("></span>")));
    assert.doesNotMatch(initial.replace(/<[^>]*>/g, ""), /통합|도구|…/);
    const matched = render(["통합적", ""]);
    assert.equal(masks(matched).filter(mask => mask.includes("is-correct")).length, 2);
    assert.match(matched, />통합<\/span>되고자/);
    assert.equal((matched.match(/<input\b/g) ?? []).length, 1);
    const guided = render([], { guidedPractice: true });
    assert.ok(masks(guided).every(mask => mask.includes("has-guide") && mask.includes("is-missed")));
    const hinted = render([], { hints: { 0: { stage: 2, revision: 1, keyword: "통합적", text: "ㅌㅎㅈ" } } });
    assert.ok(masks(hinted).every(mask => !mask.includes("is-correct") && !mask.includes("has-guide")), "hint exposure alone doesn't solve references");
    const evaluations = evaluateQuizAnswers(card.keywords, ["통합적", "오답"], false);
    const correction = quizInlineCorrections(parts, evaluations, ["통합적", "오답"]);
    const correcting = render(correction.answers, { partsOverride: correction.parts, correctionMode: true });
    assert.equal(masks(correcting).filter(mask => mask.includes("is-correct")).length, 2);
    assert.equal(masks(correcting).filter(mask => mask.includes("has-guide")).length, 1);
    const complete = render(["도구적"], { partsOverride: correction.parts, correctionMode: true });
    assert.ok(masks(complete).every(mask => mask.includes("is-correct")));
    assert.equal((complete.match(/<input\b/g) ?? []).length, 0);
    const weak = render([], { partsOverride: keywordReviewParts(card, "도구적", isTable ? parts.find(p => p.keyword === "도구적").keywordId : undefined) });
    assert.equal(masks(weak).filter(mask => mask.includes("is-correct")).length, 2);
    assert.equal((weak.match(/<input\b/g) ?? []).length, 1);
    assert.equal(JSON.stringify(card), snapshot);
    assert.deepEqual(evaluations, [{ matched: true, expectedKeyword: "통합적" }, { matched: false, expectedKeyword: "도구적" }]);
  }
});

test("explicitly bold repeated answers remain separate inputs and unordered matches reveal the matched concept", async () => {
  const { QuizCloze } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = { id: -901, answer: "통합적, 도구적 : 통합 및 도구, 통합적", answerFormat: "[b]통합적[/b], [b]도구적[/b] : 통합 및 도구, [b]통합적[/b]", keywords: ["통합적", "도구적"] };
  const render = answers => renderToStaticMarkup(React.createElement(QuizCloze, { card, answers, checked: false, orderIndependentOverride: true, onChange() {}, onSubmit() {} }));
  assert.equal((render([]).match(/<input\b/g) ?? []).length, 3);
  const matched = render(["도구적"]);
  assert.equal((matched.match(/<input\b/g) ?? []).length, 2);
  assert.match(matched, /answer-keyword-blank is-correct[^>]*>도구<\/span>/);
  assert.match(matched, /answer-keyword-blank is-missed[^>]*><\/span>/);
});

test("study and quiz questions fill matching red blanks in green without ellipses or source edits", async () => {
  const { QuestionContent, StudyQuestionText } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = {
    question: "우리가 실제로 지각하는 시간이며, 미래는 무수한 '지금'으로 이루어지는 시간이다. 지금은?",
    questionFormat: "[b]우리가[/b] 실제로 지각하는 시간이며, [u]미래[/u]는 무수한 '[b]지[/b][u]금[/u]'으로 이루어지는 시간이다. 지금은?",
    media: { question: [], answer: [], memo: [] },
  };
  const snapshot = JSON.stringify(card);
  for (const render of [
    (hiddenKeywords, revealedKeywords) => renderToStaticMarkup(React.createElement(QuestionContent, { card, hiddenKeywords, revealedKeywords })),
    (hiddenKeywords, revealedKeywords) => renderToStaticMarkup(React.createElement(StudyQuestionText, { text: card.question, format: card.questionFormat, hiddenKeywords, revealedKeywords })),
  ]) {
    const hidden = render(["지금"]);
    assert.equal((hidden.match(/class="question-keyword-blank is-missed"/g) ?? []).length, 2);
    assert.doesNotMatch(hidden.replace(/<[^>]*>/g, ""), /지금/);
    assert.doesNotMatch(hidden, /…|\.\.\./);
    assert.match(hidden, /<strong>우리가<\/strong>/);
    assert.match(hidden, /<u>미래<\/u>/);
    assert.match(hidden, /으로 이루어지는 시간이다\./);
    const matched = render(["지금"], ["지금"]);
    assert.equal((matched.match(/class="question-keyword-blank is-correct"/g) ?? []).length, 2);
    assert.doesNotMatch(matched, /is-missed/);
    assert.equal((matched.match(/>지금<\/span>/g) ?? []).length, 2);
    const original = render(undefined);
    assert.doesNotMatch(original, /question-keyword-blank/);
    assert.match(original, /<strong>지<\/strong><u>금<\/u>/);
    assert.match(original, /지금은/);
  }
  assert.equal(JSON.stringify(card), snapshot, "displaying blanks does not rewrite stored card content");
});

test("question feedback fills only the matched keyword and every repeated copy", async () => {
  const { QuestionContent } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = { question: "지금과 미래, 다시 지금", questionFormat: "", media: {} };
  const render = revealedKeywords => renderToStaticMarkup(React.createElement(QuestionContent, {
    card, hiddenKeywords: ["지금", "미래"], revealedKeywords,
  }));
  const partial = render(["지금"]);
  assert.equal((partial.match(/question-keyword-blank is-correct/g) ?? []).length, 2);
  assert.equal((partial.match(/question-keyword-blank is-missed/g) ?? []).length, 1);
  assert.doesNotMatch(partial, /미래/);
  const corrected = render(["지금", "미래"]);
  assert.equal((corrected.match(/question-keyword-blank is-correct/g) ?? []).length, 3);
  assert.doesNotMatch(corrected, /is-missed/);
});

test("practice question guides stay uncompleted until matched and add no surrounding spaces", async () => {
  const { QuestionContent, StudyQuestionText } = await vite.ssrLoadModule("/app/study-app.tsx");
  for (const keyword of ["지금", "가", "NOW", "깊이 있는 학습", "안전·지속가능"]) {
    const question = `'${keyword}'으로 이어진다.`;
    for (const render of [
      revealedKeywords => renderToStaticMarkup(React.createElement(QuestionContent, {
        card: { question, questionFormat: "", media: {} }, hiddenKeywords: [keyword], revealedKeywords, guidedPractice: true,
      })),
      revealedKeywords => renderToStaticMarkup(React.createElement(StudyQuestionText, {
        text: question, format: "", hiddenKeywords: [keyword], revealedKeywords, guidedPractice: true,
      })),
    ]) {
      const guide = render([]);
      assert.match(guide, /class="question-keyword-blank is-missed has-guide"/);
      assert.doesNotMatch(guide, /is-correct/);
      assert.ok(guide.includes(`>${keyword}</span>&#x27;으로`));
      const matched = render([keyword]);
      assert.match(matched, /class="question-keyword-blank is-correct"/);
      assert.doesNotMatch(matched, /has-guide|is-missed/);
      assert.ok(matched.includes(`>${keyword}</span>&#x27;으로`));
    }
  }
});

test("masks repeated question keywords in context and opens every copy after one answer", async () => {
  const { ConnectionPractice, connectionPracticeParts } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = {
    id: 5, contentType: "교육과정", section: "총론", subsection: "", detailSection: "",
    question: "학생의 관심을 살피고 학생을 지원하는 방법은?",
    questionFormat: "[b]학생[/b]의 관심을 살피고 [b]학생[/b]을 지원하는 방법은?",
    answer: "학생의 요구를 반영한다.", answerFormat: "[b]학생[/b]의 요구를 반영한다.", keywords: ["학생"],
  };
  const parts = connectionPracticeParts(card);
  assert.equal(parts.question.filter((part) => part.type === "blank").length, 1);
  const render = (answers, reverse) => renderToStaticMarkup(React.createElement(ConnectionPractice, {
    card, answers, reverse, checked: false, onChange() {}, onSubmit() {}, onContinue() {},
  }));
  for (const reverse of [false, true]) {
    const initial = render([], reverse);
    assert.match(initial, /의 관심을 살피고/);
    assert.match(initial, /의 요구를 반영한다/);
    assert.doesNotMatch(initial, /학생/);
    assert.equal((initial.match(/<input\b/g) ?? []).length, 1);
    assert.equal((initial.match(/class="connection-keyword-mask"/g) ?? []).length, 2);
    const completed = render(["학생"], reverse);
    assert.doesNotMatch(completed, /class="connection-keyword-mask"/);
    assert.equal((completed.match(/학생/g) ?? []).length, 3);
    assert.doesNotMatch(completed, /<input\b/);
  }
});

test("connection answer masking preserves emphasis, underlines and whitespace across format boundaries", async () => {
  const { ConnectionAnswerContent, connectionPracticeParts } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = {
    question: "학생 모형", questionFormat: "[b]학생[/b] 모형", keywords: ["중요", "실행"],
    answer: "1. 학생의 중요 단계\n2. 학생 실행",
    answerFormat: "1. 학[u]생[/u]의 [b] 중요 [/b]단계\n2. [b]학생[/b] [accent]실행[/accent]",
  };
  const parts = connectionPracticeParts(card).answer;
  assert.equal(parts.map((part) => part.value).join(""), "1. 학생의  중요 단계\n2. 학생 실행");
  const render = (checked, revealedKeywords) => renderToStaticMarkup(React.createElement(ConnectionAnswerContent, { card, parts, checked, revealedKeywords }));
  const hidden = render(false, []);
  assert.equal((hidden.match(/connection-keyword-mask/g) ?? []).length, 2);
  assert.doesNotMatch(hidden, /학|생/);
  assert.match(hidden, /class="answer-keyword"> 중요 <\/strong>/);
  assert.match(hidden, /class="answer-keyword">실행<\/strong>/);
  assert.match(hidden, /단계\n2\./);
  for (const shown of [render(true, []), render(false, ["학생"])]) {
    assert.doesNotMatch(shown, /connection-keyword-mask/);
    assert.match(shown, /학<u>생<\/u>/);
    assert.match(shown, /class="answer-keyword">학생<\/strong>/);
  }
  const plainCard = { ...card, answerFormat: "" };
  const plainParts = connectionPracticeParts(plainCard).answer;
  const plain = renderToStaticMarkup(React.createElement(ConnectionAnswerContent, { card: plainCard, parts: plainParts, checked: false, revealedKeywords: [] }));
  assert.match(plain, /class="answer-keyword">중요<\/strong>/);
  assert.match(plain, /class="answer-keyword">실행<\/strong>/);
});

test("connection panels balance by content length and keep scrolling inside the panels", async () => {
  const { connectionPaneFractions, ConnectionPractice } = await vite.ssrLoadModule("/app/study-app.tsx");
  const short = connectionPaneFractions("답", "질문", 1);
  const longAnswer = connectionPaneFractions("긴 답안입니다.\n".repeat(20), "모형 단계", 1);
  const longQuestion = connectionPaneFractions("답", "긴 질문\n".repeat(20), 10);
  assert.ok(longAnswer.answer > short.answer);
  assert.ok(longQuestion.question > short.question);
  for (const fractions of [short, longAnswer, longQuestion]) {
    assert.ok(fractions.answer >= 0.38 && fractions.answer <= 0.74);
    assert.ok(Math.abs(fractions.answer + fractions.question - 1) < 0.00001);
  }
  const card = { id: 1, section: "", subsection: "", detailSection: "", contentType: "수업모형", question: "학생 단계", questionFormat: "[b]학생[/b] 단계", answer: "학생의 중요 단계", answerFormat: "[b]학생[/b]의 [u]중요[/u] 단계", keywords: ["학생"] };
  for (const reverse of [false, true]) for (const checked of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(ConnectionPractice, { card, answers: [], checked, reverse, onChange() {}, onSubmit() {}, onContinue() {} }));
    assert.match(html, /class="connection-practice-body" style="grid-template-rows:minmax\(0,/);
    assert.match(html, /class="connection-source-answer"><small>[^<]*<\/small><p>/);
    assert.doesNotMatch(html, /connection-masked-answer/);
  }
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.connection-practice-body \{ display: grid; min-height: 0; flex: 1;/);
  assert.match(css, /\.connection-source-answer \{[^}]*overflow-y: auto;[^}]*overscroll-behavior-y: contain;/);
  assert.match(css, /\.connection-source-answer \.answer-keyword:empty \{ display: none; \}/);
  assert.doesNotMatch(css, /connection-source-answer[^}]*max-height: (?:27|32)%/);
  assert.match(css, /\.connection-practice > button \{[^}]*flex: 0 0 auto;/);
});

test("guided practice records participation without changing card or keyword mastery", async () => {
  const { studyRecordedKeywords, shouldRecordStudyCard } = await vite.ssrLoadModule("/app/study-app.tsx");
  const results = [{ keyword: "학생", matched: true }, { keyword: "학교", matched: false }];
  assert.deepEqual(studyRecordedKeywords(results, "practice"), []);
  assert.deepEqual(studyRecordedKeywords(results, "real"), results);
  assert.deepEqual(studyRecordedKeywords([results[1]], "practice"), []);
  for (const round of ["main", "mistake-review"]) {
    assert.equal(shouldRecordStudyCard("practice", round, "incorrect"), false);
    assert.equal(shouldRecordStudyCard("practice", round, "correct"), false);
  }
  assert.equal(shouldRecordStudyCard("real", "main", "incorrect"), true);
  assert.equal(shouldRecordStudyCard("real", "mistake-review", "incorrect"), false);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /const recorded = studyRecordedKeywords\(results, studySessionMode\);\s*if \(recorded.length\) queueKeywordAttempt\(card, recorded\)/);
  assert.match(source, /if \(studySessionMode === "real"\) recordStudyKeywordAttempt\(current, tableAttemptResults\(currentStudyParts, evaluations\)\)/);
  assert.match(source, /const outcome = studyAttemptOutcome\(studySessionMode, studyRound, result, usedHint\)/);
});

test("real study defers hinted success while guided practice neither scores nor retries", async () => {
  const { studyAttemptOutcome, quizAttemptOutcome, studyHintAllowed } = await vite.ssrLoadModule("/app/study-app.tsx");
  for (const round of ["main", "mistake-review"]) {
    for (const result of ["correct", "incorrect"]) {
      for (const hinted of [false, true]) {
        assert.deepEqual(studyAttemptOutcome("real", round, result, hinted), quizAttemptOutcome(round === "main" ? "main" : "retry", result === "correct", hinted));
        assert.deepEqual(studyAttemptOutcome("practice", round, result, hinted), {
          reviewResult: null,
          retry: false,
        });
      }
    }
    assert.equal(studyHintAllowed("real", round), round === "main");
    assert.equal(studyHintAllowed("practice", round), false);
  }
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const hint = source.slice(source.indexOf("  function revealStudyHint("), source.indexOf("  function gradeStudyKeywords("));
  assert.match(hint, /if \(!studyHintAllowed\(studySessionMode, studyRound\)\) return/);
  assert.match(hint, /studyHintRetryAnswersRef.current === null/);
  assert.match(hint, /currentStudyEvaluations\[answerIndex\]\?\.matched \? answer : ""/);
  assert.match(source, /if \(outcome.retry\) \{\s*setSessionIncorrectCardIds/);
  assert.match(source, /studySessionMode === "real" && usedHint\s*\? studyHintRetryAnswersRef.current \?\? \[\]/);
  assert.match(source, /studyHintRetryAnswersRef.current = null/);
  assert.match(source, /!answered && currentStudyKeywords.length > 0 && studySessionMode === "real" && studyHintAllowed\(studySessionMode, studyRound\)/);
});

test("study starts directly with the saved mode and only locks it during the running session", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pendingStudyStart|beginConfirmedStudy/);
  assert.match(source, /function changeStudySessionMode\(practice: boolean\) \{\s*if \(studyStarted && !studyFinished\) return/);
  assert.match(source, /startStudyAt\(selectedIds\[0\], selectedIds\)/);
  assert.match(source, /startStudyAt\(resumeCardId, resumeSequenceIds, resumeSessionMode\)/);
});

test("pause preserves remaining milliseconds and guards study input, grading and timeout", async () => {
  const { remainingStudyTime } = await vite.ssrLoadModule("/app/study-app.tsx");
  const paused = remainingStudyTime(40_000, 40_000, 12_345);
  assert.equal(paused, 27_655);
  assert.equal(remainingStudyTime(null, paused, 99_999), paused);
  assert.equal(remainingStudyTime(100_000 + paused, paused, 101_000), 26_655);
  assert.equal(remainingStudyTime(40_000, 40_000, 41_000), 0);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  for (const name of ["updateStudyKeywordAnswer", "updateStudyConnectionAnswer", "gradeStudyConnection", "gradeStudyKeywords", "showWrittenAnswer", "revealStudyAnswerWithoutKeywords", "record", "finishStudyConnection"]) {
    assert.match(source, new RegExp(`function ${name}\\([^\\n]*\\) \\{\\s*if \\(studyPausedRef.current\\) return;`));
  }
  assert.match(source, /const timerPaused = [^;]*!current \|\| studyPaused/);
  assert.match(source, /const updateTimer = \(\) => \{\s*if \(studyPausedRef.current\) return/);
  assert.match(source, /<article inert=\{studyPaused\}/);
  assert.match(source, /disabled=\{answered \|\| studyPaused\}/);
  assert.match(source, /<StudyClockControl[\s\S]*?paused=\{studyPaused\}[\s\S]*?onPause=\{pauseStudy\} onResume=\{resumeStudy\}/);
  assert.match(source, /<Dialog open=\{paused\}[\s\S]*?showCloseButton=\{false\}[\s\S]*?onClick=\{resume\}/);
});

test("long questions add the same reading allowance to quiz and real study", async () => {
  const { questionReadingTime, quizQuestionTimeLimit, studyQuestionTimeLimit } = await vite.ssrLoadModule("/app/study-app.tsx");
  for (const [length, extra] of [[0, 0], [50, 0], [51, 1], [55, 1], [56, 2], [100, 10], [200, 30]]) {
    assert.equal(questionReadingTime("가".repeat(length)), extra);
  }
  const question = "가".repeat(100);
  assert.equal(questionReadingTime(`[b]${"가 ".repeat(50)}[/b]\n[u]${"가".repeat(50)}[/u]`), 10);
  assert.equal(questionReadingTime(question.normalize("NFD")), 10);
  const card = { id: 1, question, questionFormat: "", answer: "한국 소나무", answerFormat: "[b]한국[/b] [b]소나무[/b]", keywords: ["한국", "소나무"] };
  for (const mobile of [false, true]) {
    assert.equal(quizQuestionTimeLimit(card.keywords, [], false, mobile, question), 35 + (mobile ? 20 : 0));
    assert.equal(studyQuestionTimeLimit(card, [], mobile), 35 + (mobile ? 20 : 0));
    assert.equal(studyQuestionTimeLimit(card, ["한국"], mobile), 33 + (mobile ? 20 : 0));
    assert.equal(quizQuestionTimeLimit(card.keywords, ["한국"], false, mobile, question), 33 + (mobile ? 20 : 0));
    assert.equal(studyQuestionTimeLimit({ ...card, question: "짧은 원문", questionFormat: `[b]${question}[/b]` }, [], mobile), 35 + (mobile ? 20 : 0));
  }
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /const currentQuizTimeLimit = quizQuestionTimeLimit\([\s\S]*?isMobileViewport,\s*currentQuizCard\?\.questionFormat \|\| currentQuizCard\?\.question \|\| ""/);
});

test("study real mode shares quiz timing and every answer review freezes the clock", async () => {
  const { studyQuestionTimeLimit, quizQuestionTimeLimit } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = { id: 1, answer: "언어 수리 디지털 기초 소양", answerFormat: "[b]언어[/b] [b]수리[/b] [b]디지털 기초 소양[/b]", keywords: ["언어", "수리", "디지털 기초 소양"] };
  for (const mobile of [false, true]) {
    assert.equal(studyQuestionTimeLimit(card, [], mobile), 31 + (mobile ? 20 : 0));
    assert.equal(studyQuestionTimeLimit(card, ["언어", "", ""], mobile), 29 + (mobile ? 20 : 0));
    assert.equal(studyQuestionTimeLimit(card, [], mobile), quizQuestionTimeLimit(card.keywords, [], false, mobile));
    assert.equal(studyQuestionTimeLimit({ ...card, answer: "한국", answerFormat: "", keywords: [] }, [], mobile), 22 + (mobile ? 20 : 0));
  }
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const normalized = source.replace(/\r\n/g, "\n");
  const start = normalized.indexOf("  useEffect(() => {\n    if (!current || answered) return;");
  assert.ok(start >= 0);
  const end = normalized.indexOf("  useEffect(() => {\n    if (currentQuizCardId", start);
  assert.ok(end > start);
  const effects = normalized.slice(start, end);
  for (const mode of ["reveal", "write"]) for (const answered of [false, true]) for (const todayReview of [false, true]) {
    let now = 1000, tick, seconds = 13, grades = 0;
    const remaining = { current: 13_000 }, deadline = { current: null };
    const cleanup = [];
    const scope = {
      useEffect: (callback) => { const stop = callback(); if (stop) cleanup.push(stop); },
      current: card, answered, currentStudyTimeLimit: 51, mode, studyRound: todayReview ? "today-review" : "main", studySessionMode: "real", todayReview, todayReviewTurn: 0,
      studyPaused: false, studyConnectionActive: false, studyKeywordMode: mode === "reveal",
      sectionAnnouncement: null, dialogOpen: false, bulkOpen: false, pendingSessionExit: null,
      studyTimerRemainingMsRef: remaining, studyTimerDeadlineRef: deadline,
      resolvedStudyCardIdRef: { current: null }, studyPausedRef: { current: false },
      setStudySecondsLeft: (value) => { seconds = value; }, queueMicrotask: (callback) => callback(),
      Date: { now: () => now },
      window: { setInterval: (callback) => { tick = callback; return 1; }, clearInterval() {} },
      gradeStudyKeywordsEvent: () => { grades++; }, recordStudyResult: () => { grades++; },
    };
    new Function(...Object.keys(scope), effects)(...Object.values(scope));
    if (answered) {
      assert.equal(tick, undefined, `${mode} review never starts an interval`);
      assert.equal(remaining.current, 13_000, "review does not reset the remaining time");
      assert.equal(seconds, 13);
    } else if (todayReview) {
      assert.equal(tick, undefined, `${mode} today review is untimed`);
    } else {
      assert.equal(seconds, 51);
      now += 2000;
      tick();
      assert.equal(seconds, 49);
      assert.equal(remaining.current, 49_000);
    }
    cleanup.forEach((stop) => stop());
    assert.equal(grades, 0);
  }
  assert.match(source, /untimed=\{studyConnectionActive \|\| answered\}/);
  assert.match(source, /studyKeywordMode && studyRound === "mistake-review"/);
  assert.doesNotMatch(source, /ANSWER_TIME_LIMIT_SECONDS|QUESTION_TIME_LIMIT_SECONDS|answer-timeout|문제 풀이 40초/);
});

test("the study screen toggle still reflects and locks the active mode", async () => {
  const { StudyModeSwitch } = await vite.ssrLoadModule("/app/study-app.tsx");
  for (const mode of ["real", "practice"]) {
    const html = renderToStaticMarkup(React.createElement(StudyModeSwitch, { mode, onCheckedChange() {} }));
    assert.match(html, /role="switch"/);
    assert.match(html, new RegExp(`aria-checked="${mode === "practice"}"`));
    assert.match(html, /실전/);
    assert.match(html, /연습/);
    assert.doesNotMatch(html, /role="radio"/);
  }
  const locked = renderToStaticMarkup(React.createElement(StudyModeSwitch, { mode: "real", disabled: true, onCheckedChange() {} }));
  assert.match(locked, /disabled=""/);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /<StudyModeSwitch mode=\{studySessionMode\} disabled=\{studyStarted && !studyFinished\}/);
  assert.doesNotMatch(source, /className="study-mode-options"/);
});

test("the running clock is the pause control, with no separate pause button", async () => {
  const { StudyClockControl } = await vite.ssrLoadModule("/app/study-app.tsx");
  const props = { seconds: 39, phase: "문제", paused: false, blocked: false, onPause() {}, onResume() {} };
  const html = renderToStaticMarkup(React.createElement(StudyClockControl, props));
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.match(html, /aria-label="문제 남은 시간 39초 · 일시정지"/);
  assert.match(html, /lucide-play/);
  assert.match(html, /<strong>39<\/strong>/);
  const untimed = renderToStaticMarkup(React.createElement(StudyClockControl, { ...props, untimed: true, phase: "연결" }));
  assert.match(untimed, /연결 시간 제한 없음/);
  assert.doesNotMatch(untimed, /<strong>39<\/strong>/);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /onClick=\{pauseStudy\}>일시정지/);
});

test("quiz pause freezes its exact remaining time and resume preserves it", async () => {
  const { remainingStudyTime } = await vite.ssrLoadModule("/app/study-app.tsx");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const body = (name) => source.match(new RegExp(`function ${name}\\(\\) \\{([\\s\\S]*?)\\n  \\}`))[1];
  let now = 12_345;
  let paused = false;
  let seconds = 40;
  const pausedRef = { current: false };
  const deadline = { current: 40_000 };
  const remaining = { current: 40_000 };
  const context = {
    mainTab: "quiz", currentQuizCard: { id: 1 }, quizFinished: false,
    quizPausedRef: pausedRef, quizTimerDeadlineRef: deadline, quizTimerRemainingMsRef: remaining,
    remainingStudyTime, Date: { now: () => now }, document: { activeElement: null }, HTMLElement: class {},
    setQuizSecondsLeft: (value) => { seconds = value; }, setQuizPaused: (value) => { paused = value; },
  };
  const pause = new Function(...Object.keys(context), body("pauseQuiz")).bind(null, ...Object.values(context));
  const resume = new Function(...Object.keys(context), body("resumeQuiz")).bind(null, ...Object.values(context));
  pause();
  assert.equal(paused, true);
  assert.equal(pausedRef.current, true);
  assert.equal(deadline.current, null);
  assert.equal(remaining.current, 27_655);
  assert.equal(seconds, 28);
  now += 90_000;
  pause();
  assert.equal(remaining.current, 27_655);
  resume();
  assert.equal(paused, false);
  assert.equal(pausedRef.current, false);
  assert.equal(remaining.current, 27_655);
  assert.equal(remainingStudyTime(now + remaining.current, remaining.current, now + 1_000), 26_655);
  assert.doesNotMatch(body("pauseQuiz") + body("resumeQuiz"), /setQuizAnswers|setQuizHints|setQuizChecked|queue.*Attempt|queue.*Review/);
});

test("set study opens the responsive collection viewer without leaving the sets tab", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{editSetFromFlow\}><Pencil \/> 수정/);
  assert.match(source, /: viewStudySet\?\.name \?\? `/);
  assert.match(source, /if \(returnToFlowAfterBulkEdit\) handleBulkDialogOpenChange\(false\)/);
  const editBody = source.match(/function editSetFromFlow\(\) \{([\s\S]*?)\n  \}/)[1];
  const transitions = [];
  new Function("viewStudySet", "rememberFlowScrollPosition", "setReturnToFlowAfterBulkEdit", "setFlowOpen", "openSetEdit", editBody)(
    { id: 23 }, () => transitions.push("remember"), value => transitions.push(value), value => transitions.push(value), set => transitions.push(set.id));
  assert.deepEqual(transitions, [true, 23]);
  assert.doesNotMatch(editBody, /setFlowOpen\(false\)/);
  assert.match(source, /BulkCreateDialog layered=\{returnToFlowAfterBulkEdit\}/);
  assert.match(source, /CardDialog layered=\{returnToFlowAfterEdit\}/);
  const body = source.match(/function chooseSet\(set: StudySet\) \{([\s\S]*?)\n  \}/)[1];
  const choose = new Function("set", "resetStudy", "setSubject", "setIdFromStudyValue", "setStudyValue", "setSection", "setImportance", "setReviewOrder", "window", "openMobileCards", "openFlowTable", "setStudySelecting", "setSelectedLearningSetIds", body);
  for (const mobile of [true, false]) {
    const calls = [];
    choose({ id: 23 }, () => {}, value => calls.push(value), () => {}, id => `set:${id}`,
      value => assert.equal(value, "all"), value => assert.equal(value, "all"), value => assert.equal(value, "saved"),
      { matchMedia: query => { assert.equal(query, "(max-width: 759px)"); return { matches: mobile }; } },
      id => calls.push(["cards", id]), (restore, id) => calls.push(["table", id]), false, () => {});
    assert.deepEqual(calls, [[mobile ? "cards" : "table", 23]]);
  }
  assert.doesNotMatch(body, /setMainTab|resetStudy|setSubject|setSection|setImportance|setReviewOrder/);
  assert.doesNotMatch(source, /이 세트 학습하기/);
});

test("comparison set tiles show up to four cards in a compact grid", async () => {
  const { CompareSetCardList } = await vite.ssrLoadModule("/app/study-app.tsx");
  const cards = [1, 2, 3, 4, 5].map(id => ({ id, question: `질문 ${id}`, questionFormat: "", contentType: "교육과정" }));
  const html = renderToStaticMarkup(React.createElement(CompareSetCardList, { cards }));
  assert.equal((html.match(/<li>/g) ?? []).length, 4);
  for (const card of cards.slice(0, 4)) assert.ok(html.includes(card.question));
  assert.ok(!html.includes(cards[4].question));
  assert.match(html, /class="set-question-preview is-grid"/);
  assert.match(html, /aria-label="세트에 포함된 카드 5장 중 처음 4장 미리보기"/);
  assert.equal((html.match(/class="set-preview-type"/g) ?? []).length, 4);
  const twoCards = renderToStaticMarkup(React.createElement(CompareSetCardList, { cards: cards.slice(0, 2) }));
  assert.match(twoCards, /class="set-question-preview"/);
  assert.doesNotMatch(twoCards, /class="set-question-preview is-grid"/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.set-library-card \{[^}]*height: 274px/);
  assert.match(css, /\.set-question-preview\.is-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.set-preview-copy > p\s*\{[^}]*white-space: pre-wrap/);
  assert.match(css, /\.set-preview-copy > p\s*\{[^}]*overflow-wrap: anywhere/);
});

test("set study actions have distinct colors and announcements unmount without fallback flashes", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /data-action=\{setStudySelecting \? selectedLearningSetIds.length \? "start" : "cancel" : "learn"\}/);
  const backgrounds = ["learn", "start", "cancel"].map(action => css.match(new RegExp(`\\.set-study-action\\[data-action="${action}"\\] \\{ background: ([^;]+)`))[1]);
  assert.equal(new Set(backgrounds).size, 3);
  assert.match(source, /\{sectionAnnouncement && <Dialog open onOpenChange=/);
  assert.doesNotMatch(source, /\{pendingStudyStart !== null && <Dialog open onOpenChange=/);
  assert.doesNotMatch(source, /<Dialog open=\{Boolean\(sectionAnnouncement\)\}/);
  assert.match(source, /\{!sectionAnnouncement.setInfo && <div className="section-announcement-lines">/);
});

test("ready study Escape returns through the back action without interrupting study or dialogs", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const body = source.match(/const leaveReadyStudyOnEscape = \(event: KeyboardEvent\) => \{([\s\S]*?)\n    \};/)[1];
  let backs = 0;
  const foregroundEscapes = new WeakSet();
  const handle = new Function("event", "document", "leaveStudySelection", "foregroundEscapes", body);
  const event = {key: "Escape", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }};
  const invoke = (overrides = {}, layer = false, closedLayer = false) => {
    const key = {...event, ...overrides};
    if (closedLayer) foregroundEscapes.add(key);
    handle(key, {querySelector: () => layer ? {} : null}, () => backs++, foregroundEscapes);
    return key;
  };
  for (const overrides of [{key: "Enter"}, {defaultPrevented: true}, {cancelBubble: true}, {isComposing: true}, {keyCode: 229}, {repeat: true}, {ctrlKey: true}]) invoke(overrides);
  invoke({}, true);
  invoke({}, false, true);
  assert.equal(backs, 0);
  const handled = invoke();
  assert.equal(backs, 1);
  assert.equal(handled.defaultPrevented, true, "prevents the global focus-only fallback on the same Escape");
  assert.equal(handled.cancelBubble, true);
  assert.match(source, /if \(mainTab !== "study" \|\| !subject \|\| studyStarted \|\| studyFinished\) return/);
  assert.match(source, /removeEventListener\("keydown", leaveReadyStudyOnEscape\)/);
  const backBody = source.match(/function leaveStudySelection\(\) \{([\s\S]*?)\n  \}/)[1];
  for (const [subject, expectedTab] of [["총론", null], ["선택한 비교 세트", "sets"]]) {
    const calls = [];
    new Function("activeStudySet", "subject", "SELECTED_SETS_VIEW", "resetStudy", "setSubject", "setMainTab", "requestSessionExit", backBody)(null, subject, "선택한 비교 세트", () => calls.push("reset"), value => calls.push(value), value => calls.push(value), action => action());
    assert.deepEqual(calls, expectedTab ? ["reset", "", expectedTab] : ["reset", ""]);
  }
});

test("site-wide Escape clears only leftover focus after local cancellation", async () => {
  const { installEscapeFocusReset } = await vite.ssrLoadModule("/app/study-app.tsx");
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let layer = false;
  let blurCount = 0;
  const button = {isConnected: true, blur() { blurCount++; doc.activeElement = doc.body; }};
  const doc = {body: {}, documentElement: {}, activeElement: button, querySelector: () => layer ? {} : null};
  const win = {
    addEventListener: (name, fn, capture = false) => listeners.set(capture, fn),
    removeEventListener: (name, fn, capture = false) => { assert.equal(listeners.get(capture), fn); listeners.delete(capture); },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  };
  const cleanup = installEscapeFocusReset(win, doc);
  const press = (overrides = {}, afterCapture = () => {}, afterBubble = () => {}) => {
    const event = {key: "Escape", defaultPrevented: false, ...overrides};
    listeners.get(true)(event);
    afterCapture(event);
    listeners.get(false)(event);
    afterBubble(event);
    const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
  };
  // First Escape belongs to selection cancellation, even if its handler runs later.
  press({}, () => {}, event => { event.defaultPrevented = true; });
  assert.equal(blurCount, 0);
  press();
  assert.equal(blurCount, 1);
  doc.activeElement = button;
  layer = true;
  press({}, () => { layer = false; }); // Closing a dialog must not also blur its return target.
  assert.equal(blurCount, 1);
  for (const overrides of [{key: "Enter"}, {repeat: true}, {isComposing: true}, {keyCode: 229}, {ctrlKey: true}, {defaultPrevented: true}, {cancelBubble: true}]) press(overrides);
  assert.equal(blurCount, 1);
  press({}, () => {}, () => { doc.activeElement = {}; });
  assert.equal(blurCount, 1, "does not blur a newly focused element");
  doc.activeElement = button;
  listeners.get(false)({key: "Escape"});
  cleanup();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
});

test("Escape cancels set learning selection without closing foreground dialogs", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const body = source.match(/const cancelSetStudyOnEscape = \(event: KeyboardEvent\) => \{([\s\S]*?)\n    \};/)[1].replace("querySelector<HTMLButtonElement>", "querySelector");
  const cancelBody = source.match(/function cancelSetStudySelection\(\) \{([\s\S]*?)\n  \}/)[1];
  for (const ids of [[], [1, 2]]) {
    const state = { ids, selecting: true };
    let focused = false;
    const cancel = () => new Function("setSelectedLearningSetIds", "setSetStudySelecting", cancelBody)(value => state.ids = value, value => state.selecting = value);
    const handle = new Function("event", "document", "cancelSetStudySelection", body);
    const event = { key: "Escape", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    const document = {querySelector: selector => selector === ".set-study-action" ? {focus: () => { focused = true; }} : null};
    handle({...event, key: "Enter"}, document, cancel);
    assert.equal(state.selecting, true);
    handle(event, {querySelector: () => ({})}, cancel);
    assert.equal(state.selecting, true);
    handle(event, document, cancel);
    assert.deepEqual(state, {ids: [], selecting: false});
    assert.equal(focused, true);
    assert.equal(event.defaultPrevented, true);
  }
  assert.match(source, /if \(mainTab !== "sets" \|\| !setStudySelecting\) return/);
  assert.match(source, /removeEventListener\("keydown", cancelSetStudyOnEscape\)/);
});

test("set learning toggles selection and starts only the chosen sets", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const body = source.match(/function handleSetStudyAction\(\) \{([\s\S]*?)\n  \}/)[1];
  const calls = {};
  const setters = ["setSelectedLearningSetIds", "setSetStudySelecting", "resetStudy", "setLearningSetIds", "setSubject", "setSection", "setImportance", "setReviewOrder", "setMainTab", "setPendingSetStudyIds"];
  const cancelBody = source.match(/function cancelSetStudySelection\(\) \{([\s\S]*?)\n  \}/)[1];
  const run = new Function("setStudySelecting", "selectedLearningSetIds", "sets", "cards", "toast", "SELECTED_SETS_VIEW", "studySessionMode", ...setters, `function cancelSetStudySelection() {${cancelBody}}\n${body}`);
  const invoke = (selecting, ids) => run(selecting, ids, [{id: 1, cardIds: [2, 1]}, {id: 2, cardIds: [2, 3, 4]}, {id: 9, cardIds: [5]}], [1, 2, 3, 4, 5].map(id => ({id, sortOrder: id, archivedAt: id === 4 ? "archived" : null})), {error: message => { throw new Error(message); }}, "selected-sets", "practice", ...setters.map(key => value => { calls[key] = value; }));
  invoke(false, []);
  assert.equal(calls.setSetStudySelecting, true);
  invoke(true, []);
  assert.equal(calls.setSetStudySelecting, false);
  invoke(true, [1, 2]);
  assert.deepEqual(calls.setPendingSetStudyIds, [1, 2, 3]);
  assert.deepEqual(calls.setLearningSetIds, [1, 2]);
  assert.equal(calls.setMainTab, "study");
  assert.equal(calls.setSubject, "selected-sets");
  assert.match(source, /setInfo: \{ name: set.name, memo: set.memo \}/);
  assert.match(source, /remainingStudySequence\((?:todayIds \?\? )?filtered\.map\(\(card\) => card\.id\), startCardId, savedSequence\)/);
});

test("each subject has a distinct shade shared by its badge and chooser stripe", async () => {
  const { SubjectBadge, subjectColorIndex, SubjectChooser } = await vite.ssrLoadModule("/app/study-app.tsx");
  const groups = [
    ["총론", "창체", "통합교과"],
    ["국어", "영어", "수학", "과학"],
    ["사회", "도덕", "미술", "음악"],
    ["실과", "체육"],
  ];
  const subjects = groups.flat();
  const paletteIndices = [[1, 5, 9], [2, 6, 10, 14], [3, 7, 11, 15], [4, 12]];
  const colors = new Map([
    [1, "25855b"], [5, "4faa7e"], [9, "77d0a2"],
    [2, "88520c"], [6, "ae7538"], [10, "d59a5e"], [14, "fec083"],
    [3, "3e6389"], [7, "6087af"], [11, "84acd6"], [15, "a9d2fe"],
    [4, "a16bae"], [12, "c890d5"],
  ]);
  const chooser = renderToStaticMarkup(React.createElement(SubjectChooser, {
    subjects, cards: [], sets: [], onSelect() {}, onSelectSets() {},
  }));
  groups.forEach((group, column) => group.forEach((subject, row) => {
    const index = paletteIndices[column][row];
    assert.equal(subjectColorIndex(subject, [...subjects].reverse()), index);
    assert.equal((index - 1) % 4, column);
    const html = renderToStaticMarkup(React.createElement(SubjectBadge, { subject, subjects }));
    assert.match(html, new RegExp(`subject-badge subject-palette-${index}`));
    assert.match(html, new RegExp(`>${subject}</span>`));
    assert.match(chooser, new RegExp(`subject-dot subject-dot-${index}[^>]*></span><strong>${subject === "통합교과" ? "통합" : subject}</strong>`));
  }));
  assert.equal(subjectColorIndex("기타 둘", [...subjects, "기타 하나", "기타 둘"]), 2);
  assert.equal(subjectColorIndex("미지정"), 1);
  const css = await readFile(path.join(root, "app/globals.css"), "utf8");
  assert.equal(new Set(colors.values()).size, subjects.length);
  const linearRgb = (hex) => hex.match(/../g).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = (hex) => linearRgb(hex).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  const oklab = (hex) => {
    const [r, g, b] = linearRgb(hex);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
  };
  colors.forEach((hex, index) => {
    assert.ok(css.includes(`.subject-dot-${index}, .subject-palette-${index} { --subject-color: #${hex}; }`));
    const background = luminance(hex), foreground = luminance([1, 2, 3].includes(index) ? "ffffff" : "0b1510");
    assert.ok((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05) >= 4.5);
  });
  paletteIndices.forEach((indices) => {
    const shades = indices.map((index) => oklab(colors.get(index)));
    assert.ok(Math.abs(shades.reduce((sum, [lightness]) => sum + lightness, 0) / shades.length - .67) < .003);
    shades.slice(1).forEach((shade, index) => {
      assert.ok(Math.abs(shade[0] - shades[index][0] - .12) < .003, "equal perceptual lightness steps");
      assert.ok(Math.hypot(shade[1] - shades[index][1], shade[2] - shades[index][2]) < .003, "fixed family hue and chroma");
    });
  });
  assert.match(css, /\.subject-palette-1, \.subject-palette-2, \.subject-palette-3 \{ --subject-foreground: #ffffff; \}/);
  assert.match(css, /\.subject-badge\[data-slot="badge"\] \{ color: var\(--subject-foreground, #0b1510\); background: var\(--subject-color\); \}/);
  const source = await readFile(path.join(root, "app/study-app.tsx"), "utf8");
  for (const card of ["card", "detailCard", "current", "currentQuizCard", "set"]) {
    assert.ok(source.includes(`<SubjectBadge subject={${card}.subject} subjects={subjects} />`));
  }
  assert.ok(source.includes('<ContentTypeBadge value={card.contentType} />'));
});

test("resume ends at the last card and repairs previously rotated saved sequences", async () => {
  const { remainingStudySequence } = await vite.ssrLoadModule("/app/study-app.tsx");
  const ordered = [1, 2, 3, 4, 5];
  assert.deepEqual(remainingStudySequence(ordered, 3), [3, 4, 5]);
  assert.deepEqual(remainingStudySequence(ordered, 5, ordered), [5]);
  assert.deepEqual(remainingStudySequence(ordered, 4, [3, 4, 5, 1, 2]), [4, 5]);
  assert.deepEqual(remainingStudySequence(ordered, 3, [1, 3, 5, 99]), [3, 5]);
  assert.deepEqual(remainingStudySequence([1, 2, 3, 4, 5, 6], 3, ordered), [3, 4, 5]);
  assert.deepEqual(remainingStudySequence(ordered, 1), ordered);
  assert.deepEqual(remainingStudySequence(ordered, 99, ordered), []);
  assert.deepEqual(remainingStudySequence([3, 1, 5, 2, 4], 5), [5, 2, 4]);
});

test("review content stays graded while saved edits and live metadata remain available", async () => {
  const { cardWithReviewContent, evaluateQuizAnswers } = await vite.ssrLoadModule("/app/study-app.tsx");
  const reviewed = { id: 1, question: "질문", questionFormat: "", answer: "기초", answerFormat: "", keywords: ["기초"], memo: "원래 메모", importance: 1, correctCount: 0 };
  const edited = { ...reviewed, question: "수정 질문", answer: "기본", keywords: ["기본", "추가"], memo: "수정 메모", importance: 2, correctCount: 1 };
  const review = cardWithReviewContent(edited, reviewed);
  assert.equal(review.answer, "기초");
  assert.equal(review.question, "질문");
  assert.equal(review.memo, "원래 메모");
  assert.equal(review.importance, 2);
  assert.equal(review.correctCount, 1);
  assert.equal(evaluateQuizAnswers(review.keywords, ["기초"], false)[0].matched, true);
  assert.deepEqual(cardWithReviewContent(edited, null), edited, "next question uses saved content");
  assert.deepEqual(cardWithReviewContent({ ...edited, id: 2 }, reviewed).keywords, edited.keywords);
  assert.equal(cardWithReviewContent(null, reviewed), null);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /const current = cardWithReviewContent\(liveStudyCard, studyReviewCard\)/);
  assert.match(source, /const currentQuizCard = cardWithReviewContent\(liveQuizCard, quizReviewCard\)/);
  assert.match(source, /function resetStudyKeywordSupport\(\) \{\s*setStudyReviewCard\(null\)/);
  assert.match(source, /function resetQuizAssistState\(\) \{\s*setQuizReviewCard\(null\)/);
  assert.match(source, /function nextQuizQuestion[\s\S]*?setQuizReviewCard\(null\)/);
  assert.match(source, /function openEdit\(card: StudyCard\)[\s\S]*?setEditing\(cards.find/);
  assert.match(source, /async function toggleCardImportance\(displayedCard: StudyCard\) \{\s*const card = cards.find\(\(item\) => item.id === displayedCard.id\) \?\? displayedCard/);
});

test("completed correction blanks keep green feedback without changing original correct keywords", async () => {
  const { QuizCloze, areQuizCorrectionsComplete } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = { id: 1, question: "", answer: "인권 인성", keywords: ["인권", "인성"] };
  const props = { card, partsOverride: [{ type: "text", value: "인권", isCorrectAnswer: true }, { type: "blank", keyword: "인성" }], answers: ["인성"], checked: false, correctionMode: true, onChange() {}, onSubmit() {} };
  const html = renderToStaticMarkup(React.createElement(QuizCloze, props));
  assert.match(html, /class="cloze-inline-answer is-correct is-review-text">인권/);
  assert.match(html, /class="cloze-inline-answer is-correct is-review-text">인성/);
  assert.doesNotMatch(html, /<input/);
  assert.equal(areQuizCorrectionsComplete(["인성"], ["인성"], false), true);
  assert.equal(areQuizCorrectionsComplete(["인성"], ["인권"], false), false);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.quiz-cloze-copy \.cloze-inline-answer\.is-review-text\s*\{[^}]*background: #dcefe2/);
});

test("keyword review replaces the heading and leaves no empty materials box", async () => {
  const { KeywordAnswerLabel, KeywordReviewMaterials } = await vite.ssrLoadModule("/app/study-app.tsx");
  assert.match(renderToStaticMarkup(React.createElement(KeywordAnswerLabel, { result: "correct" })), />정답<\/span>/);
  assert.match(renderToStaticMarkup(React.createElement(KeywordAnswerLabel, { result: "incorrect" })), />오답<\/span>/);
  assert.equal(renderToStaticMarkup(React.createElement(KeywordReviewMaterials, { card: { memo: "", media: { answer: [], memo: [] } } })), "");
  const memo = renderToStaticMarkup(React.createElement(KeywordReviewMaterials, { card: { memo: "검증용 설명", media: { answer: [], memo: [] } } }));
  assert.match(memo, /검증용 설명/);
  assert.doesNotMatch(memo, /quiz-full-answer|comparison-answer/);
});

test("quiz expands sets consecutively without duplicates or ineligible cards", async () => {
  const { groupQuizSetCards } = await vite.ssrLoadModule("/app/study-app.tsx");
  const cards = [1, 2, 3, 4, 5, 6, 7].map(id => ({ id, archivedAt: id === 7 ? "2026-09-01" : null }));
  const items = [{ cardId: 1, reason: "recommended" }, { cardId: 4, reason: "recommended" }, { cardId: 3, reason: "keyword-review", keyword: "학생" }];
  const sets = [{ cardIds: [1, 2, 3, 99] }, { cardIds: [3, 5, 7] }];
  const grouped = groupQuizSetCards(items, cards, sets);
  assert.deepEqual(grouped.map(item => item.cardId), [1, 2, 3, 5, 7, 4]);
  assert.deepEqual(grouped[2], items[2], "preserves keyword-only review metadata");
  assert.equal(grouped[4].reason, "archive-review");
  assert.deepEqual(groupQuizSetCards(items, cards, []).map(item => item.cardId), [1, 4, 3]);
  assert.deepEqual(groupQuizSetCards([], cards, sets), []);
  assert.deepEqual(groupQuizSetCards(items.slice(0, 1), cards.filter(card => ![2, 3, 7].includes(card.id)), sets).map(item => item.cardId), [1], "recent, out-of-scope and unavailable members remain excluded");
});

test("editor Shift selection reuses set details after saving and cancels safely", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const body = name => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{([\\s\\S]*?)\\n  \\}`))[1];
  const selection = { current: null };
  let selected = null;
  class TestNode {}
  const {selectEditorItems}=await vite.ssrLoadModule("/lib/editor-selection.ts");
  const anchor={current:null};
  const select = new Function("event", "rowId", "setMode", "editorSetSelectionRef", "viewing", "closing", "cancelPickedRowMove", "setEditorSetSelection", "isPhotoInteraction", "Node", "Element", "desktopEditorSelection", "visibleBulkRowIds", "rowsRef", "collapsedDividerIds", "editorSelectionAnchorRef", "selectEditorItems", body("selectEditorSetRow"));
  const click = (id, shiftKey = false, photo = false) => select({ target: new TestNode(), currentTarget: { contains: () => true }, shiftKey, preventDefault() {}, stopPropagation() {} }, id, false, selection, false, false, () => {}, ids => { selected = ids; }, () => photo, TestNode, class {}, ()=>false, ()=>["a","b"], {current:[{type:"card",id:"a"},{type:"card",id:"b"}]}, new Set(), anchor, selectEditorItems);
  click("a", true, true);
  assert.equal(selected, null, "photo enlargement must not start set selection");
  click("a");
  assert.equal(selected, null, "normal editing click must not start selection");
  click("a", true);
  click("b", true);
  assert.deepEqual(selected, ["a", "b"]);
  click("a");
  assert.deepEqual(selected, ["b"]);
  click("a", true);
  let details = false;
  let cardIds = [];
  const rows = { current: [{ type: "card", id: "a", cardId: null, question: "A", answer: "a" }, { type: "card", id: "b", cardId: 2, question: "B", answer: "b" }] };
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const returnScroll = { current: null };
  const create = new AsyncFunction("editorSetSelectionRef", "viewing", "closing", "setViewing", "persistCards", "rowsRef", "toast", "setSetCardIds", "setSetCreateStep", "setEditorSetDetails", "editorSetReturnScrollRef", "bulkDialogRef", body("createSetFromEditorSelection").replaceAll("<HTMLElement>", ""));
  const run = save => create(selection, false, false, () => {}, save, rows, { error: assert.fail }, ids => { cardIds = ids; }, step => assert.equal(step, "details"), value => { details = value; }, returnScroll, { current: { querySelector: selector => { assert.equal(selector, ".bulk-form"); return { scrollTop: 840 }; } } });
  await run(async () => { rows.current[0].cardId = 1; return true; });
  assert.deepEqual(cardIds, [1, 2]);
  assert.equal(details, true);
  assert.equal(returnScroll.current, 840);
  details = false;
  await run(async () => { selection.current = null; return true; });
  assert.equal(details, false, "cancel during saving must not open details");
  assert.match(source, /onClickCapture=\{\(event\) => selectEditorSetRow\(event, row.id\)\}/);
  assert.match(source, /editorSetSelection !== null \? "세트" : "보기"/);
  assert.match(source, /editorSetSelection !== null \? "취소"/);
  assert.match(source, /onEscapeKeyDown=\{\(event\) => \{[^]*?cancelEditorSetSelection\(\)/);
});

test("nested set completion and cancellation retain the card editor and restore its position", async () => {
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const resetBody = source.match(/function cancelEditorSetSelection\(\) \{([\s\S]*?)\n  \}/)[1];
  const state = { selection: ["a", "b"], details: true, id: 41, step: "details", cards: [1, 2], name: "세트", memo: "설명" };
  const selectionRef = { current: state.selection };
  const keys = ["selection", "details", "id", "step", "cards", "name", "memo"];
  const reset = new Function("editorSelectionAnchorRef", "editorSetSelectionRef", "setEditorSetSelection", "setEditorSetDetails", "setSetId", "setSetCreateStep", "setSetCardIds", "setSetName", "setSetMemo", resetBody);
  const anchorRef={current:"a"};
  reset(anchorRef, selectionRef, ...keys.map(key => value => { state[key] = value; }));
  assert.equal(anchorRef.current,null);
  assert.deepEqual(state, { selection: null, details: false, id: null, step: "cards", cards: [], name: "", memo: "" });
  assert.equal(selectionRef.current, null);
  const completion = source.match(/if \(editorSetDetails\) cancelEditorSetSelection\(\);\s*else if \(creatingSet\) onOpenChange\(false\);/)[0];
  const finish = new Function("editorSetDetails", "creatingSet", "cancelEditorSetSelection", "onOpenChange", completion);
  for (const creating of [true, false]) {
    let returned = 0;
    finish(true, creating, () => returned++, assert.fail);
    assert.equal(returned, 1);
  }
  let closed = false;
  finish(false, true, assert.fail, open => { closed = !open; });
  assert.equal(closed, true, "standalone creation still closes");
  assert.match(source, /top: editorSetDetails \? 0 : editorSetReturnScrollRef.current, behavior: "instant"/);
  assert.doesNotMatch(resetBody, /setRows|setCollapsedDividerIds|undoStackRef|onOpenChange/);
});

test("quiz toolbar restores its original layout with only restart slightly smaller", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.quiz-toolbar \{[^}]*justify-content: space-between;[^}]*gap: 8px;[^}]*margin-bottom: 8px;/);
  assert.match(css, /\.is-quizzing \.quiz-toolbar \{ margin-bottom: 4px; \}/);
  assert.match(css, /\.quiz-toolbar \.quiz-restart-button \{ height: 32px; min-width: 96px;/);
  assert.match(css, /\.is-quizzing \.quiz-toolbar \.quiz-restart-button \{ height: 32px; \}/);
  assert.match(css, /\.quiz-restart-button.is-confirming \{[^}]*background: #b93838; color: #fff;/);
  assert.match(css, /\.study-progress-meta \{[^}]*justify-content: flex-end;/);
});

test("quiz restart requires two activations and outside interactions cancel confirmation", async () => {
  const { QuizRestartButton } = await vite.ssrLoadModule("/app/study-app.tsx");
  const html = renderToStaticMarkup(React.createElement(QuizRestartButton, { onRestart() {} }));
  assert.match(html, /새 5퀴즈/);
  assert.match(html, /data-size="sm"/);
  assert.match(html, /data-variant="outline"/);
  assert.doesNotMatch(html, /is-confirming/);
  const disabledHtml = renderToStaticMarkup(React.createElement(QuizRestartButton, { disabled: true, onRestart() {} }));
  assert.match(disabledHtml, /disabled=""/);

  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const component = source.slice(source.indexOf("export function QuizRestartButton("), source.indexOf("export function StudyClockControl("));
  const body = (name) => component.match(new RegExp(`function ${name}\\(\\) \\{([\\s\\S]*?)\\n  \\}`))[1];
  const confirmingRef = { current: false };
  let confirming = false;
  let restarts = 0;
  const setConfirming = value => { confirming = value; };
  const cancel = new Function("confirmingRef", "setConfirming", body("cancelConfirmation")).bind(null, confirmingRef, setConfirming);
  const activate = new Function("disabled", "confirmingRef", "setConfirming", "cancelConfirmation", "onRestart", body("activate"));
  const click = (disabled = false) => activate(disabled, confirmingRef, setConfirming, cancel, () => { restarts += 1; });
  click();
  assert.equal(confirming, true);
  assert.equal(restarts, 0);
  click();
  assert.equal(restarts, 1);
  assert.equal(confirming, false);

  class FakeNode {}
  const child = new FakeNode();
  const outside = new FakeNode();
  const buttonRef = { current: { contains: target => target === child } };
  const outsideBody = component.match(/const cancelOutside = \(event: Event\) => \{([\s\S]*?)\n    \};/)[1];
  const dismiss = new Function("event", "Node", "buttonRef", "cancelConfirmation", outsideBody);
  click();
  dismiss({ target: child }, FakeNode, buttonRef, cancel);
  assert.equal(confirming, true);
  dismiss({ target: outside }, FakeNode, buttonRef, cancel);
  assert.equal(confirming, false);
  click();
  assert.equal(restarts, 1, "after cancellation the next click only arms confirmation");
  click(true);
  assert.equal(restarts, 1, "paused quiz cannot restart");
  cancel();
  for (const event of ["pointerdown", "click", "focusin"]) {
    assert.ok(component.includes(`document.addEventListener("${event}", cancelOutside, true)`));
    assert.ok(component.includes(`document.removeEventListener("${event}", cancelOutside, true)`));
  }
  assert.match(component, /confirming \? "destructive" : "outline"/);
  assert.match(component, /confirming \? "한 번 더" : "새 5퀴즈"/);
  assert.match(component, /event.repeat[^]*?event.preventDefault\(\)/);
  assert.match(source, /<QuizRestartButton key=\{quizSessionRevision\} onRestart=\{startQuiz\} disabled=\{quizPaused\}/);
});

test("quiz shares study clock controls and blocks actions and timeout while paused", async () => {
  const { StudyClockControl } = await vite.ssrLoadModule("/app/study-app.tsx");
  const html = renderToStaticMarkup(React.createElement(StudyClockControl, {
    seconds: 28, phase: "문제", paused: true, blocked: false, activity: "퀴즈", onPause() {}, onResume() {},
  }));
  assert.match(html, /문제 남은 시간 28초 · 퀴즈 재개/);
  assert.match(html, /lucide-pause/);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  for (const name of ["startQuiz", "leaveQuiz", "updateQuizAnswer", "updateQuizConnectionAnswer", "gradeQuizConnection", "revealQuizHint", "resolveQuizAttempt", "gradeQuiz", "nextQuizQuestion", "finishQuizConnection"]) {
    assert.match(source, new RegExp(`function ${name}\\([^\\n]*\\) \\{\\s*if \\(quizPausedRef.current\\) return;`));
  }
  assert.match(source, /const timerPaused = mainTab !== "quiz" \|\| quizPaused/);
  assert.match(source, /const updateTimer = \(\) => \{\s*if \(quizPausedRef.current\) return;/);
  assert.match(source, /quizTimerDeadlineRef.current = Date.now\(\) \+ quizTimerRemainingMsRef.current/);
  assert.match(source, /\[bulkOpen, currentQuizCard,[^\]]*quizPaused, pendingSessionExit\]/);
  assert.match(source, /\[currentQuizCardId, currentQuizTimeLimit, quizChecked, quizFinished, quizRound, quizIndex, quizSessionRevision\]/);
  assert.match(source, /<StudyClockControl activity="퀴즈"[^]*?paused=\{quizPaused\}[^]*?onPause=\{pauseQuiz\} onResume=\{resumeQuiz\}/);
  assert.match(source, /<article inert=\{quizPaused\}/);
  assert.match(source, /className="quiz-toolbar" inert=\{quizPaused\}/);
  assert.match(source, /setQuizCorrectionAnswers\(\(previous\) => \{\s*if \(quizPausedRef.current\) return previous;/);
  assert.match(source, /const handleEnter = \(event: KeyboardEvent\) => \{\s*if \(quizPausedRef.current\) return;/);
});

test("clock shortcuts ignore composition, modifiers, repeats and other dialogs", async () => {
  const { studyClockShortcut } = await vite.ssrLoadModule("/app/study-app.tsx");
  assert.equal(studyClockShortcut({ key: "Escape" }, false), "pause");
  assert.equal(studyClockShortcut({ key: "Enter" }, true), "resume");
  assert.equal(studyClockShortcut({ key: "Enter" }, false), null);
  assert.equal(studyClockShortcut({ key: "Escape" }, true), "resume");
  for (const [key, paused] of [["Enter", true], ["Escape", false], ["Escape", true]]) {
    assert.equal(studyClockShortcut({ key }, paused, true), null);
    for (const flag of ["repeat", "isComposing", "altKey", "ctrlKey", "metaKey", "shiftKey", "defaultPrevented"]) {
      assert.equal(studyClockShortcut({ key, [flag]: true }, paused), null);
    }
    assert.equal(studyClockShortcut({ key, keyCode: 229 }, paused), null);
  }
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /재개 \(Enter \/ Esc\)/);
  assert.match(source, /Enter 또는 Esc를 눌러 재개/);
  assert.match(source, /시계를 눌러 재개<span> · Enter \/ Esc/);
});

test("clock expansion measures its original position and resumes only after shrinking", async () => {
  const { studyClockOriginTransform } = await vite.ssrLoadModule("/app/study-app.tsx");
  assert.equal(studyClockOriginTransform({ left: 1000, top: 190, width: 90, height: 26 }, { width: 360, height: 200 }, { width: 1200, height: 900 }), "translate(445px, -247px) scale(0.25, 0.13)");
  assert.equal(studyClockOriginTransform({ left: 260, top: 120, width: 84, height: 26 }, { width: 336, height: 208 }, { width: 368, height: 800 }), "translate(118px, -267px) scale(0.25, 0.125)");
  assert.equal(studyClockOriginTransform({ left: 260, top: 120, width: 84, height: 26 }, { width: 336, height: 208 }, { left: 10, top: 50, width: 368, height: 600 }), "translate(108px, -217px) scale(0.25, 0.125)");
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const clock = source.slice(source.indexOf("export function StudyClockControl("), source.indexOf("export function quizQuestionTimeLimit("));
  assert.match(clock, /getBoundingClientRect\(\)/);
  assert.match(clock, /panel\.offsetWidth/);
  assert.match(clock, /animation\.onfinish = finish/);
  assert.match(clock, /prefers-reduced-motion: reduce/);
  assert.match(clock, /closing \? <Play[^]*?: <Pause/);
  assert.match(clock, /event\.preventDefault\(\);\s*event\.stopPropagation\(\)/);
});

test("equal mode buttons highlight the existing toggle and start the clicked mode immediately", async () => {
  const { StudyModeStartChoices } = await vite.ssrLoadModule("/app/study-app.tsx");
  for (const mode of ["real", "practice"]) {
    const chosen = [];
    const element = StudyModeStartChoices({ mode, onStart: choice => chosen.push(choice) });
    const html = renderToStaticMarkup(element);
    assert.equal((html.match(/<button\b/g) ?? []).length, 2);
    assert.match(html, new RegExp(`study-mode-start is-${mode} is-current`));
    assert.equal((html.match(/현재 설정/g) ?? []).length, 1);
    assert.doesNotMatch(html, /role="switch"/);
    for (const button of element.props.children) button.props.onClick();
    assert.deepEqual(chosen, ["real", "practice"]);
  }
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.study-mode-start-choices\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("pause keeps its small clock visible with a viewport-centered panel", async () => {
  const { StudyClockControl } = await vite.ssrLoadModule("/app/study-app.tsx");
  const html = renderToStaticMarkup(React.createElement(StudyClockControl, { seconds: 39, phase: "문제", paused: true, blocked: false, onPause() {}, onResume() {} }));
  assert.match(html, /study-clock-control/);
  assert.match(html, /lucide-pause/);
  assert.doesNotMatch(html, /is-expanded/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.study-clock-stage\[data-slot="dialog-content"\]\s*\{[^}]*inset: 0;[^}]*height: 100dvh;[^}]*transform: none/);
  assert.match(css, /\.study-clock-center\s*\{[^}]*position: absolute;[^}]*inset: 0;[^}]*place-items: center/);
  assert.doesNotMatch(css, /\.study-clock-control[^}]*visibility: hidden/);
  const source = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  assert.match(source, /className="study-timer study-clock-anchor"[^]*?onClick=\{resume\}/);
});

test("shows the answer while completing the question connection", async () => {
  const { ConnectionPractice, connectionContextPath, shouldFocusConnectionContinue } = await vite.ssrLoadModule("/app/study-app.tsx");
  const card = {
    id: 1,
    contentType: "교육과정",
    area: "교육과정",
    section: "총론",
    subsection: "학교 교육과정",
    detailSection: "편성",
    answer: "교사는 학생을 이해한다",
    answerFormat: "",
    keywords: ["학생"],
    question: "교사가 해야 할 일은?",
    questionFormat: "교사가 해야 할 [b]일[/b]은?",
  };
  const html = renderToStaticMarkup(React.createElement(ConnectionPractice, {
    card,
    answers: [],
    checked: false,
    reverse: false,
    onChange() {},
    onSubmit() {},
    onContinue() {},
  }));

  assert.match(html, /질문의 핵심도 완성해보세요/);
  assert.match(html, /총론 › 학교 교육과정 › 편성/);
  assert.match(html, /연결할 답/);
  assert.match(html, /교사는 .*학생.*을 이해한다/);
  assert.equal(connectionContextPath("총론", "", "편성"), "총론 › 편성");
  assert.equal(shouldFocusConnectionContinue(true, true), true);
  assert.equal(shouldFocusConnectionContinue(true, false), false);
  assert.equal(shouldFocusConnectionContinue(false, true), false);
  const checkedWrong = renderToStaticMarkup(React.createElement(ConnectionPractice, {
    card, answers: ["틀림"], checked: true, reverse: false, onChange() {}, onSubmit() {}, onContinue() {},
  }));
  assert.match(checkedWrong, /cloze-field-hint[^>]*>.*일/);
  assert.doesNotMatch(checkedWrong, /quiz-answer-keyword/);
  assert.match(checkedWrong, /disabled=""[^>]*>다음으로/);
});

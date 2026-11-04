import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ root, configFile: false, appType: "custom", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false, ws: false } });
after(() => vite.close());
const app = await vite.ssrLoadModule("/app/study-app.tsx");
const table = await vite.ssrLoadModule("/lib/table-card.ts");

const musicLines = [
  ["박", "박자"],
  ["장단", "장단의 세"],
  ["음의 길고 짧음"],
  ["간단한 리듬꼴"],
  ["장단꼴"],
  ["말붙임새"],
];
const musicKeywords = musicLines.flat();
const musicFormat = musicLines.map(items => `• ${items.map(item => `[b]${item}[/b]`).join(", ")}`).join("\n");

function listParts(lines, markers = ["•"], newline = "\n") {
  return lines.flatMap((items, line) => items.flatMap((keyword, index) => [
    { type: "text", value: index ? ", " : `${line ? newline : ""}${markers[line % markers.length]} ` },
    { type: "blank", keyword },
  ]));
}

test("standalone 말붙임새 stays separate from the 박/박자 pair for legacy, canonical and mixed bullets", () => {
  const keywords = ["말붙임새", "박", "박자"];
  for (const markers of [["-"], ["•"], ["-", "•"], ["•", "—"]]) {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const parts = listParts([[keywords[0]], keywords.slice(1)], markers, newline);
      const order = app.quizAnswerOrder(parts);
      assert.deepEqual(order, [0, 1, 1]);
      assert.ok(app.evaluateQuizAnswers(keywords, ["말붙임새", "박자", "박"], order).every(item => item.matched));
      assert.deepEqual(app.evaluateQuizAnswers(keywords, ["박", "말붙임새", "박자"], order).map(item => item.matched), [false, false, true]);
      assert.equal(app.planMatchedQuizAnswer(keywords, [], 0, "박", order), null);
      assert.equal(app.quizHintKeywords(keywords, ["박"], order)[0], "말붙임새");
    }
  }
});

test("music table keeps two comma pairs and one reorderable run of standalone items", () => {
  let doc = table.createTable(1, 1);
  doc = table.editCell(doc, doc.cells[0].id, musicFormat);
  const original = table.encodeTable(doc);
  const parts = table.tableParts(doc), order = app.quizAnswerOrder(parts);
  assert.deepEqual(order, [0, 0, 1, 1, 2, 2, 2, 2]);
  const reordered = ["박자", "박", "장단의 세", "장단", "말붙임새", "장단꼴", "음의 길고 짧음", "간단한 리듬꼴"];
  const results = app.evaluateQuizAnswers(musicKeywords, reordered, order);
  assert.ok(results.every(item => item.matched));
  assert.equal(app.planMatchedQuizAnswer(musicKeywords, [], 0, "말붙임새", order), null);
  assert.ok(app.planMatchedQuizAnswer(musicKeywords, [], 0, "박자", order));
  assert.ok(app.planMatchedQuizAnswer(musicKeywords, [], 4, "말붙임새", order));
  const hints = app.quizHintKeywords(musicKeywords, ["말", "", "", "", "말"], order);
  assert.ok(["박", "박자"].includes(hints[0]));
  assert.equal(hints[4], "말붙임새");
  const identifiers = new Map(table.tableKeywords(original).map(item => [item.keyword, item.keywordKey]));
  assert.deepEqual(app.tableAttemptResults(parts, results).map(item => item.keywordKey), reordered.map(word => identifiers.get(word)));
  assert.equal(table.encodeTable(doc), original, "grading and hint grouping must not rewrite the stored table or its learning IDs");
});

test("cross-group mistakes retain the right correction keyword, group and table learning ID", () => {
  let doc = table.createTable(1, 1);
  doc = table.editCell(doc, doc.cells[0].id, musicFormat);
  const parts = table.tableParts(doc), order = app.quizAnswerOrder(parts);
  const answers = ["말붙임새", "박", "장단의 세", "장단", "간단한 리듬꼴", "음의 길고 짧음", "장단꼴", "박자"];
  const evaluations = app.evaluateQuizAnswers(musicKeywords, answers, order);
  assert.deepEqual(evaluations.map(item => item.matched), [false, true, true, true, true, true, true, false]);
  const missed = app.quizCorrectionKeywords(evaluations);
  const correctionOrder = app.quizCorrectionOrder(order, evaluations);
  assert.deepEqual(missed, ["박자", "말붙임새"]);
  assert.deepEqual(correctionOrder, [0, 2]);
  assert.equal(app.areQuizCorrectionsComplete(missed, ["말붙임새", "박자"], correctionOrder), false);
  assert.equal(app.areQuizCorrectionsComplete(missed, missed, correctionOrder), true);
  const correction = app.quizInlineCorrections(parts, evaluations, answers);
  const blanks = correction.parts.filter(part => part.type === "blank");
  assert.deepEqual(blanks.map(part => part.keyword), missed);
  const identifiers = new Map(table.tableKeywords(table.encodeTable(doc)).map(item => [item.keyword, item.keywordKey]));
  assert.deepEqual(blanks.map(part => part.keywordId), missed.map(word => identifiers.get(word)));
});

test("neighboring table cells remain separate even when the same keyword appears in both", () => {
  let doc = table.createTable(1, 2);
  doc = table.editCell(doc, doc.cells[0].id, "• [b]말붙임새[/b]\n• [b]박[/b], [b]박자[/b]");
  doc = table.editCell(doc, doc.cells[1].id, "• [b]박[/b], [b]장단[/b]");
  const parts = table.tableParts(doc), order = app.quizAnswerOrder(parts);
  const keywords = parts.filter(part => part.type === "blank").map(part => part.keyword);
  assert.deepEqual(order, [0, 1, 1, 4, 4]);
  const evaluations = app.evaluateQuizAnswers(keywords, ["말붙임새", "박자", "박", "장단", "박"], order);
  assert.ok(evaluations.every(item => item.matched));
  const ids = table.tableKeywords(table.encodeTable(doc)).map(item => item.keywordKey);
  assert.deepEqual(app.tableAttemptResults(parts, evaluations).map(item => item.keywordKey), [ids[0], ids[2], ids[1], ids[4], ids[3]]);
  assert.equal(app.planMatchedQuizAnswer(keywords, [], 1, "장단", order), null);
});

test("single-keyword sibling bullets keep order independence and indentation boundaries", () => {
  const keywords = ["능력", "적성", "진로"];
  for (const markers of [["-"], ["•"], ["•", "-"]]) {
    const parts = listParts(keywords.map(keyword => [keyword]), markers);
    assert.equal(app.quizAnswerOrder(parts), true);
    assert.ok(app.evaluateQuizAnswers(keywords, [...keywords].reverse(), app.quizAnswerOrder(parts)).every(item => item.matched));
  }
  const nested = listParts([["부모 하나"], ["자식 하나"], ["자식 둘"], ["부모 둘"]]);
  nested[2].value = "\n    • "; nested[4].value = "\n    • ";
  assert.deepEqual(app.quizAnswerOrder(nested), [0, 1, 1, 0]);
});

test("shared explicit endings still allow one moral-principles list across mixed bullet sizes", () => {
  const names = ["정합성", "인지화", "심정화", "행동화", "통합성", "능동적 참여와 토론 학습"];
  for (const fullKeyword of [true, false]) {
    for (const marker of ["-", "•"]) {
      const keywords = names.map(name => fullKeyword ? `${name}의 원리` : name);
      const parts = keywords.flatMap((keyword, index) => [
        { type: "text", value: index === 0 ? `${marker} ` : index === 2 || index === 3 ? ", " : `\n${marker} ` },
        { type: "blank", keyword },
        { type: "text", value: fullKeyword ? "" : "의 원리" },
      ]);
      const order = app.quizAnswerOrder(parts);
      assert.equal(order, true);
      assert.ok(app.evaluateQuizAnswers(keywords, [...keywords].reverse(), order).every(item => item.matched));
    }
  }
});

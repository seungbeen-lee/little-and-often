import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ root, configFile: false, appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
after(() => vite.close());
const { normalizeListMarkers } = await vite.ssrLoadModule("/lib/list-markers.ts");
const table = await vite.ssrLoadModule("/lib/table-card.ts");
const { importedTable, tableImportRequest } = await vite.ssrLoadModule("/lib/table-import.ts");
const cardData = await vite.ssrLoadModule("/lib/card-data.ts");

test("unordered list glyphs converge without changing editor caret offsets", () => {
  const markers = [..."•●○◦▪▫■□◆◇‣⁃-‐‑‒–—﹣－·∙⋅・･*"];
  const input = markers.map((marker, index) => `${index % 2 ? "    " : ""}${marker} [b]활동 ${index}[/b]`).join("\r\n");
  const expected = markers.map((_, index) => `${index % 2 ? "    " : ""}• [b]활동 ${index}[/b]`).join("\r\n");
  assert.equal(normalizeListMarkers(input), expected);
  assert.equal(normalizeListMarkers(input).length, input.length);
  assert.equal(normalizeListMarkers(expected), expected, "repeated autosave is idempotent");
});

test("numbering, negative numbers, punctuation within words and dividers stay unchanged", () => {
  const input = [
    "1. 자유 탐색", "① 자유 탐색", "(1) 자유 탐색", "가. 자유 탐색",
    "-3", "- 3", "－ ３", "* 3", "---", "- - -", "* * *", "· · ·", "○ ○ ○", "■ ■ ■", "○ → □",
    "→ 활동", "※ 참고", "안전·지속가능 사회", "x·y", "x - y", "3.14", "  -", "·활동",
  ].join("\n");
  assert.equal(normalizeListMarkers(input), input);
  assert.equal(normalizeListMarkers(input, { spaceAfterMarker: true }), input);
});

test("formatting tags and indentation survive single-character marker replacements", () => {
  const input = "[b]● [u]과학 가치[/u][/b]\r\n\t[i][accent]○\u00a0참여와 실천[/accent][/i]\n    [u]▪[/u] [b]안전·지속가능[/b]";
  const expected = input.replace("●", "•").replace("○", "•").replace("▪", "•");
  assert.equal(normalizeListMarkers(input), expected);
  assert.equal(table.plainCell(normalizeListMarkers(input)).length, table.plainCell(input).length);
});

test("OCR adds separators only to unambiguous unspaced bullets", () => {
  const input = "●활동\n    ◦하위 활동\n■[b]둘째[/b]\n•이미 붙어 있음\n-붙임표\n·중간점\n● 이미 공백 있음";
  const expected = "• 활동\n    • 하위 활동\n• [b]둘째[/b]\n• 이미 붙어 있음\n-붙임표\n·중간점\n• 이미 공백 있음";
  assert.equal(normalizeListMarkers(input, { spaceAfterMarker: true }), expected);
  assert.equal(normalizeListMarkers(expected, { spaceAfterMarker: true }), expected);
  assert.equal(normalizeListMarkers(input).length, input.length, "active editors retain their offsets");
});

test("one bold selection across different bullet styles yields only the item keywords", () => {
  const input = "[b]● 문제 인식 및 가설 설정\n    ○ 탐구 설계 및 수행\n· 자료 수집·분석 및 해석\n— 결론 도출 및 일반화\n■의사소통과 협업[/b]";
  const normalized = table.normalizeTableListKeywords(input);
  assert.deepEqual(cardData.extractBoldKeywords(normalized), [
    "문제 인식 및 가설 설정", "탐구 설계 및 수행", "자료 수집·분석 및 해석", "결론 도출 및 일반화", "의사소통과 협업",
  ]);
  assert.equal(table.plainCell(normalized), table.plainCell(normalizeListMarkers(input)));
  assert.equal(table.normalizeTableListKeywords(normalized), normalized);
  assert.match(normalized, /^• \[b\]/);
  assert.ok(!cardData.extractBoldKeywords(normalized).some(keyword => keyword.includes("•")));
});

test("OCR normalization preserves merged geometry and never infers keywords", () => {
  const draft = {
    rows: 3, columns: 2,
    cells: [
      { row: 0, column: 0, rowSpan: 1, colSpan: 2, text: "[b]영역[/b]", shade: 1, border: 2 },
      { row: 1, column: 0, rowSpan: 2, colSpan: 1, text: "●활동\n    ○ 하위 활동\n· 안전·지속가능", shade: 0, border: 1 },
      { row: 1, column: 1, rowSpan: 1, colSpan: 1, text: "- 첫째\n▪둘째\n1. 순서 유지", shade: 0, border: 3 },
      { row: 2, column: 1, rowSpan: 1, colSpan: 1, text: "", shade: 2, border: 1 },
    ],
  };
  const normalized = importedTable(draft);
  assert.deepEqual(normalized.cells.map(cell => [normalized.rows.indexOf(cell.row), normalized.columns.indexOf(cell.column), cell.rowSpan, cell.colSpan, cell.shade, cell.border]), draft.cells.map(cell => [cell.row, cell.column, cell.rowSpan, cell.colSpan, cell.shade, cell.border]));
  assert.deepEqual(normalized.cells.map(cell => cell.format), ["영역", "• 활동\n    • 하위 활동\n• 안전·지속가능", "• 첫째\n• 둘째\n1. 순서 유지", ""]);
  assert.deepEqual(table.tableKeywords(table.encodeTable(normalized)), []);
  assert.ok(normalized.cells.every(cell => cell.keywordIds.length === 0));
  const request = tableImportRequest("data:image/png;base64,dummy");
  assert.match(request.instructions, /unordered list markers/);
  assert.match(request.instructions, /NEVER bold/);
});

test("editing an old glyph preserves table cell and keyword identities across save/reopen", () => {
  let document = table.createTable(1, 1);
  document = table.editCell(document, document.cells[0].id, "• [b]과학 가치[/b]\n    • [b]감수성[/b]");
  document.columnWidthLocks = { [document.columns[0]]: 1 };
  const original = structuredClone(document);
  const oldFormat = document.cells[0].format.replace("•", "○").replace("    •", "    ▪");
  document.cells[0].format = oldFormat;
  const stored = table.encodeTable(document);
  assert.equal(table.readTable(stored).cells[0].format, oldFormat, "reads do not silently migrate stored content");
  const edited = table.editCell(document, document.cells[0].id, oldFormat);
  const reopened = table.readTable(table.encodeTable(edited));
  assert.deepEqual(reopened, original);
});

test("card saves keep plain text and normalized formatting in sync", () => {
  const saved = cardData.normalizeCardEditorContent({
    question: "● 질문", questionFormat: "● [u]질문[/u]",
    answer: "○ 과학 가치\n    ▪ 감수성", answerFormat: "[b]○ 과학 가치\n    ▪ 감수성[/b]",
    memo: "· 메모",
  });
  assert.equal(saved.question, "• 질문");
  assert.equal(table.plainCell(saved.questionFormat), saved.question);
  assert.equal(saved.answer, "• 과학 가치\n    • 감수성");
  assert.equal(table.plainCell(saved.answerFormat), saved.answer);
  assert.deepEqual(cardData.extractBoldKeywords(saved.answerFormat), ["과학 가치", "감수성"]);
  assert.deepEqual(cardData.normalizeCardEditorContent(saved), saved);
});

test("table saves validate raw content then normalize both table and plain answer", () => {
  let document = table.createTable(1, 1);
  document = table.editCell(document, document.cells[0].id, "• [b]과학 가치[/b]");
  document.cells[0].format = "● [b]과학 가치[/b]";
  const answerFormat = table.encodeTable(document), answer = table.tableText(document);
  const saved = cardData.normalizeCardEditorContent({ question: "질문", answer, answerFormat });
  assert.equal(saved.answer, "• 과학 가치");
  assert.equal(table.tableText(table.readTable(saved.answerFormat)), saved.answer);
  assert.deepEqual(table.readTable(saved.answerFormat).cells[0].keywordIds, document.cells[0].keywordIds);
  assert.deepEqual(cardData.normalizeCardEditorContent(saved), saved);
  assert.throws(() => cardData.normalizeCardEditorContent({ question: "질문", answer: "다른 내용", answerFormat }), /표 답안/);
});

test("saving untouched legacy colons and newlines does not reinterpret stored keyword identities", () => {
  const format = "[b]이름 : 설명\n연결 문장[/b]";
  const ordinary = { question: "질문", answer: table.plainCell(format), answerFormat: format };
  const savedOrdinary = cardData.normalizeCardEditorContent(ordinary);
  assert.equal(savedOrdinary.answerFormat, format);
  assert.deepEqual(cardData.extractBoldKeywords(savedOrdinary.answerFormat), ["이름 : 설명\n연결 문장"]);

  const document = table.createTable(1, 2);
  document.cells[0].format = "[b]이름 : 설명[/b]";
  document.cells[0].keywordIds = ["legacy-colon"];
  document.cells[1].format = "[b]첫 문장\n연결 문장[/b]";
  document.cells[1].keywordIds = ["legacy-newline"];
  const answerFormat = table.encodeTable(document);
  const savedTable = cardData.normalizeCardEditorContent({ question: "질문", answer: table.tableText(document), answerFormat });
  assert.equal(savedTable.answerFormat, answerFormat);
  assert.deepEqual(table.tableKeywords(savedTable.answerFormat), table.tableKeywords(answerFormat));
  assert.deepEqual(table.readTable(savedTable.answerFormat).cells.map(cell => cell.keywordIds), [["legacy-colon"], ["legacy-newline"]]);
});

test("glyph-only cleanup preserves learning history while real keyword changes remain edits", async () => {
  const { learningContentChanged } = await vite.ssrLoadModule("/lib/card-edit-policy.ts");
  const original = {
    subject: "과학", contentType: "교육과정", section: "기본", subsection: "", detailSection: "", area: "",
    question: "○ 질문", questionFormat: "○ [u]질문[/u]",
    answer: "● 정답", answerFormat: "● [b]정답[/b]", memo: "· 메모", media: "{}", keywords: '["정답"]',
  };
  const normalized = { ...original, ...cardData.normalizeCardEditorContent(original) };
  assert.equal(learningContentChanged(original, normalized), false);
  assert.equal(learningContentChanged(original, { ...normalized, keywords: '["다른 정답"]' }), true);
  assert.equal(learningContentChanged(original, { ...normalized, answerFormat: "• 정답" }), true, "removing bold is still a learning-content change");
  assert.equal(learningContentChanged(original, { ...normalized, memo: "• 새 설명" }), true);
});

test("glyph-only table cleanup compares each cell and retains metadata and keyword semantics", async () => {
  const { learningContentChanged } = await vite.ssrLoadModule("/lib/card-edit-policy.ts");
  let document = table.createTable(1, 2);
  document = table.editCell(document, document.cells[0].id, "• [b]첫째[/b]");
  document = table.editCell(document, document.cells[1].id, "• [b]둘째[/b]");
  document.cells[0].format = "○ [b]첫째[/b]";
  document.cells[1].format = "▪ [b]둘째[/b]";
  document.columnWidthLocks = { [document.columns[0]]: 0.3 };
  const original = {
    subject: "과학", contentType: "교육과정", section: "기본", subsection: "", detailSection: "", area: "",
    question: "질문", questionFormat: "", answer: table.tableText(document), answerFormat: table.encodeTable(document),
    memo: "", media: "{}", keywords: '["첫째","둘째"]',
  };
  assert.match(original.answer, /\t▪/);
  const normalized = { ...original, ...cardData.normalizeCardEditorContent(original) };
  assert.equal(normalized.answer, "• 첫째\t• 둘째");
  assert.equal(learningContentChanged(original, normalized), false);
  const changedIds = table.readTable(normalized.answerFormat);
  changedIds.cells[1].keywordIds[0] = "new-keyword-id";
  assert.equal(learningContentChanged(original, { ...normalized, answerFormat: table.encodeTable(changedIds) }), true);
  const changedWidth = table.readTable(normalized.answerFormat);
  changedWidth.columnWidthLocks[changedWidth.columns[0]] = 0.4;
  assert.equal(learningContentChanged(original, { ...normalized, answerFormat: table.encodeTable(changedWidth) }), true);
});

test("list navigation recognizes mixed pasted glyphs without moving logical offsets", async () => {
  const { planEditorListKey } = await vite.ssrLoadModule("/lib/editor-lists.ts");
  const text = "● 부모 항목\n○ 자식 항목";
  const childStart = text.indexOf("○");
  const tab = planEditorListKey(text, text.length, text.length, "Tab");
  assert.deepEqual(tab.edits, [{ start: childStart, end: childStart, text: "    " }]);
  assert.equal(tab.anchor, text.length + 4);
  assert.equal(tab.focus, text.length + 4);
  const lineBreak = planEditorListKey(text, text.length, text.length, "Enter", true);
  assert.deepEqual(lineBreak.edits, [{ start: text.length, end: text.length, text: "\n• " }]);
  assert.equal(lineBreak.anchor, text.length + 3);
  const unspaced = "●부모\n▪자식";
  const unspacedTab = planEditorListKey(unspaced, unspaced.length, unspaced.length, "Tab");
  assert.deepEqual(unspacedTab.edits, [{ start: unspaced.indexOf("▪"), end: unspaced.indexOf("▪"), text: "    " }]);
  assert.equal(planEditorListKey("- 3", 3, 3, "Tab"), null);
});

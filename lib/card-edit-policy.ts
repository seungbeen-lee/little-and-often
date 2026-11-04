import { normalizeListMarkers } from "./list-markers";
import { readTable, tableText, TABLE_PREFIX } from "./table-card";

// Learning content changes make a mastered card worth studying again.
// Importance and sort order are deliberately excluded: organizing cards is not a new lesson.
const learningContentFields = [
  "subject", "contentType", "section", "subsection", "detailSection", "area",
  "question", "questionFormat", "answer", "answerFormat", "memo", "media", "keywords",
] as const;

type LearningContent = Record<(typeof learningContentFields)[number], string>;

function comparableContent(content: LearningContent): LearningContent {
  const table = readTable(content.answerFormat);
  const normalizedTable = table && {
    ...table,
    // Do not re-encode or edit cells here: keyword IDs, borders, widths and all
    // other table metadata must still participate in the comparison unchanged.
    cells: table.cells.map((cell) => ({ ...cell, format: normalizeListMarkers(cell.format) })),
  };
  return {
    ...content,
    question: normalizeListMarkers(content.question),
    questionFormat: normalizeListMarkers(content.questionFormat),
    answer: table && normalizedTable && tableText(table) === content.answer
      ? tableText(normalizedTable)
      : normalizeListMarkers(content.answer),
    answerFormat: normalizedTable
      ? TABLE_PREFIX + JSON.stringify(normalizedTable)
      : normalizeListMarkers(content.answerFormat),
    memo: normalizeListMarkers(content.memo),
  };
}

export function learningContentChanged(previous: LearningContent, next: LearningContent) {
  // Display-only list glyph cleanup is not a new lesson. Bold boundaries and
  // the actual keyword list are deliberately not canonicalized away.
  const before = comparableContent(previous);
  const after = comparableContent(next);
  return learningContentFields.some((field) => before[field] !== after[field]);
}

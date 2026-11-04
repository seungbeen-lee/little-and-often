import { plainCell, sortedCells, type TableDocument } from "./table-card";

// IDs are regenerated when a template is loaded; compare its visible contents
// and layout instead. Blank cells/rows alone are not newly written content.
export function tableDraftSignature(doc: TableDocument): string {
  const contents:unknown[][]=sortedCells(doc).filter(cell => plainCell(cell.format).trim()).map(cell => [
    doc.rows.indexOf(cell.row), doc.columns.indexOf(cell.column),
    cell.rowSpan, cell.colSpan, cell.format, cell.shade,
  ]);
  if(contents.length&&Object.keys(doc.columnWidthLocks??{}).length) contents.push(["column-width-locks",...doc.columns.map(id=>doc.columnWidthLocks?.[id]??null)]);
  return JSON.stringify(contents);
}

export function hasUnsavedTableContent(doc: TableDocument, baseline: string): boolean {
  const current = tableDraftSignature(doc);
  return current !== "[]" && current !== baseline;
}

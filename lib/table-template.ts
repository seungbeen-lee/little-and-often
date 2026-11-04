import { createTable, encodeTable, fitColumnWidthLocks, MAX_TABLE_CELLS, readTable, tableId, validateTable, type TableDocument } from "./table-card";

export type TableTemplate = { id: string; name: string; format: string; createdAt: string };

// Crop to the selected block, then add two empty working rows. Unselected
// positions inside a discontiguous selection remain blank, never copy content.
export function selectedTableTemplate(doc: TableDocument, selectedIds: string[]): TableDocument {
  validateTable(doc);
  const selected = new Set(selectedIds);
  const cells = doc.cells.filter(cell => selected.has(cell.id));
  if (cells.length < 2) throw new Error("템플릿으로 저장할 칸을 여러 개 선택해 주세요.");
  const top = Math.min(...cells.map(cell => doc.rows.indexOf(cell.row)));
  const left = Math.min(...cells.map(cell => doc.columns.indexOf(cell.column)));
  const bottom = Math.max(...cells.map(cell => doc.rows.indexOf(cell.row) + cell.rowSpan));
  const right = Math.max(...cells.map(cell => doc.columns.indexOf(cell.column) + cell.colSpan));
  const rowCount = bottom - top + 2, columnCount = right - left;
  if (rowCount * columnCount > MAX_TABLE_CELLS) throw new Error(`빈 행 2개를 포함해 ${MAX_TABLE_CELLS}칸 이내가 되도록 선택 영역을 줄여 주세요.`);
  const next = createTable(rowCount, columnCount);
  if(doc.columnWidthLocks) next.columnWidthLocks=fitColumnWidthLocks(next.columns,Object.fromEntries(next.columns.flatMap((id,index)=>{
    const width=doc.columnWidthLocks?.[doc.columns[left+index]];
    return width?[[id,width]]:[];
  })));
  for (const cell of cells) {
    const rowIndex = doc.rows.indexOf(cell.row) - top, columnIndex = doc.columns.indexOf(cell.column) - left;
    next.cells = next.cells.filter(blank => {
      const r = next.rows.indexOf(blank.row), c = next.columns.indexOf(blank.column);
      return r < rowIndex || r >= rowIndex + cell.rowSpan || c < columnIndex || c >= columnIndex + cell.colSpan;
    });
    next.cells.push({ ...cell, id: tableId(), row: next.rows[rowIndex], column: next.columns[columnIndex],
      keywordIds: cell.keywordIds.map(() => tableId()), border: 1 });
  }
  return validateTable(next);
}

export function validateTemplateInput(value: unknown) {
  const input = value as Partial<TableTemplate> | null;
  if (!input || typeof input.id !== "string" || !/^[\w-]{1,80}$/.test(input.id)) throw new Error("템플릿 저장 정보를 확인해 주세요.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) throw new Error("템플릿 이름을 1~80자로 입력해 주세요.");
  const doc = readTable(input.format);
  if (!doc) throw new Error("올바른 표만 템플릿으로 저장할 수 있어요.");
  return { id: input.id, name, format: encodeTable(doc) };
}

// Templates copy layout/content, never a card's learning identity or history.
export function instantiateTableTemplate(format: string): TableDocument {
  const source = readTable(format);
  if (!source) throw new Error("템플릿의 표를 읽지 못했어요.");
  const rows = new Map(source.rows.map(id => [id, tableId()]));
  const columns = new Map(source.columns.map(id => [id, tableId()]));
  return validateTable({ version: 1, rows: [...rows.values()], columns: [...columns.values()],
    ...(source.columnWidthLocks?{columnWidthLocks:Object.fromEntries(Object.entries(source.columnWidthLocks).map(([id,width])=>[columns.get(id)!,width]))}:{}),
    cells: source.cells.map(cell => ({ ...cell, id: tableId(), row: rows.get(cell.row)!, column: columns.get(cell.column)!,
      keywordIds: cell.keywordIds.map(() => tableId()), border: 1 })) });
}

// A versioned answer document lives in the existing answer_format column.
// Ordinary cards keep their original representation; no rows are converted or reset.
import { normalizeListMarkers } from "./list-markers";
export const TABLE_PREFIX = "[table:v1]";
export const MAX_TABLE_CELLS = 400;
export const MAX_KEYWORDS = 2000;
export type TableTextAlign = "left" | "center" | "right" | "justify";
export type TableCell = { id: string; row: string; column: string; rowSpan: number; colSpan: number; format: string; keywordIds: string[]; shade: 0 | 1 | 2 | 3; border: 1 | 2 | 3; textAlign?: TableTextAlign };
export const tableCellAlignment = (cell: TableCell): TableTextAlign => cell.textAlign ?? (cell.shade ? "center" : "left");
export function cycleTableAlignment(doc: TableDocument, selected: string[]): TableDocument {
  const cells = sortedCells(doc).filter(cell => selected.includes(cell.id));
  if (!cells.length) return doc;
  const order: TableTextAlign[] = ["left", "center", "right", "justify"];
  const textAlign = order[(order.indexOf(tableCellAlignment(cells[0])) + 1) % order.length];
  return {...doc, cells: doc.cells.map(cell => selected.includes(cell.id) ? {...cell, textAlign} : cell)};
}
export type TableDocument = { version: 1; rows: string[]; columns: string[]; cells: TableCell[]; columnWidthLocks?: Record<string, number> };
export type TablePart = ({ type: "text"; value: string; isCorrectAnswer?: boolean; keywordReference?: string } | { type: "blank"; keyword: string; keywordId?: string }) & { cellId?: string };
export type TableTabOrder = "vertical" | "horizontal";
const markers = /\[\/?(?:b|u|i|accent)\]/g;
export const BOLD_BRACKET_PATTERN = /[()[\]{}（）［］｛｝〈〉《》「」『』【】〔〕]/gu;
export const plainCell = (format: string) => format.replace(markers, "");
export const isTableFormat = (format: unknown): boolean => typeof format === "string" && format.startsWith(TABLE_PREFIX);
export const tableId = () => crypto.randomUUID();

// Commas stay visible; bold still means an examinable word, never decoration.
export function splitBoldLists(format: string) {
  if (isTableFormat(format)) return format;
  return format.replace(/\[(b|accent)\]([\s\S]*?)\[\/\1\]/g, (_all, tag, value: string) => value.split(/([,，、])/u).map((part, index) => {
    if (index % 2) return part;
    const leading = part.match(/^\s*/u)?.[0] ?? "";
    const trailing = part.match(/\s*$/u)?.[0] ?? "";
    const core = part.trim();
    return plainCell(core) ? `${leading}[${tag}]${core}[/${tag}]${trailing}` : part;
  }).join(""));
}

// Apply only to edits: reinterpreting stored formats could invalidate their keyword IDs.
export function normalizeBoldBrackets(format: string) {
  if (isTableFormat(format)) return format;
  const unbold = new Set([...plainCell(format).matchAll(BOLD_BRACKET_PATTERN)].map(match => match.index!));
  return removeBoldAtOffsets(format, unbold);
}

export function normalizeBoldBullets(format: string) {
  if (isTableFormat(format)) return format;
  format = normalizeListMarkers(format);
  const unbold = new Set<number>();
  for (const match of plainCell(format).matchAll(/^[^\S\r\n]*•[^\S\r\n]*/gm)) {
    for (let i = match.index!; i < match.index! + match[0].length; i++) unbold.add(i);
  }
  return removeBoldAtOffsets(format, unbold);
}

export function normalizeTableListKeywords(format: string) {
  if (isTableFormat(format)) return format;
  format = normalizeListMarkers(format);
  const text = plainCell(format);
  // Brackets stay visible; the text enclosed by them remains a keyword.
  const unbold = new Set([...text.matchAll(BOLD_BRACKET_PATTERN)].map(match => match.index!));
  // Explicit line breaks separate keywords; visual wrapping does not.
  for (const match of text.matchAll(/[\r\n]/g)) unbold.add(match.index!);
  // A spaced label separator is not part of either keyword. Keep punctuation
  // inside words (middle dots), times and URLs untouched. Normalize edits only.
  for (const match of text.matchAll(/[^\S\r\n]*[:：][^\S\r\n]+/g)) {
    for (let i = match.index!; i < match.index! + match[0].length; i++) unbold.add(i);
  }
  // Numbered list markers need a separator/end after the dot, not a decimal digit.
  for (const match of text.matchAll(/^[^\S\r\n]*(?:-(?![^\S\r\n]*\d)|•|\d+\.(?=\s|$))[^\S\r\n]*/gm)) {
    for (let i = match.index!; i < match.index! + match[0].length; i++) unbold.add(i);
  }
  return removeBoldAtOffsets(format, unbold);
}

function removeBoldAtOffsets(format: string, unbold: Set<number>) {
  if (!unbold.size) return format;
  let output = "", offset = 0, underlineDepth = 0, italicDepth = 0;
  const bold: string[] = [];
  let activeBold: string | null = null, activeUnderline = false, activeItalic = false;
  const styles = (nextBold: string | null, nextUnderline: boolean, nextItalic = false) => {
    if (activeItalic && (!nextItalic || activeUnderline !== nextUnderline || activeBold !== nextBold)) { output += "[/i]"; activeItalic = false; }
    if (activeUnderline && (!nextUnderline || activeBold !== nextBold)) { output += "[/u]"; activeUnderline = false; }
    if (activeBold !== nextBold) {
      if (activeBold) output += `[/${activeBold}]`;
      if (nextBold) output += `[${nextBold}]`;
      activeBold = nextBold;
    }
    if (nextUnderline && !activeUnderline) { output += "[u]"; activeUnderline = true; }
    if (nextItalic && !activeItalic) { output += "[i]"; activeItalic = true; }
  };
  for (const [token] of format.matchAll(/\[\/?(?:b|accent|u|i)\]|[\s\S]/g)) {
    if (token === "[b]" || token === "[accent]") bold.push(token.slice(1, -1));
    else if (token === "[/b]" || token === "[/accent]") { bold.pop(); styles(null, false); }
    else if (token === "[u]") underlineDepth++;
    else if (token === "[/u]") underlineDepth = Math.max(0, underlineDepth - 1);
    else if (token === "[i]") italicDepth++;
    else if (token === "[/i]") italicDepth = Math.max(0, italicDepth - 1);
    else {
      styles(unbold.has(offset) ? null : bold.at(-1) ?? null, underlineDepth > 0, italicDepth > 0);
      output += token;
      offset++;
    }
  }
  styles(null, false);
  return output;
}

export function cellParts(format: string): TablePart[] {
  const source = splitBoldLists(format).replaceAll("[accent]", "[b]").replaceAll("[/accent]", "[/b]");
  const parts: TablePart[] = [];
  let offset = 0;
  for (const match of source.matchAll(/\[b\]([\s\S]*?)\[\/b\]/g)) {
    if (match.index! > offset) parts.push({ type: "text", value: plainCell(source.slice(offset, match.index)) });
    const keyword = plainCell(match[1]).trim();
    if (keyword) parts.push({ type: "blank", keyword });
    offset = match.index! + match[0].length;
  }
  if (offset < source.length) parts.push({ type: "text", value: plainCell(source.slice(offset)) });
  return parts;
}

export function createTable(rowCount = 3, columnCount = 3): TableDocument {
  const rows = Array.from({ length: rowCount }, tableId);
  const columns = Array.from({ length: columnCount }, tableId);
  return { version: 1, rows, columns, cells: rows.flatMap((row) => columns.map((column) => ({ id: tableId(), row, column, rowSpan: 1, colSpan: 1, format: "", keywordIds: [], shade: 0 as const, border: 1 as const }))) };
}

export function validateTable(value: unknown): TableDocument {
  if (!value || typeof value !== "object") throw new Error("표 데이터를 확인해 주세요.");
  const doc = value as TableDocument;
  const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string" && /^[\w-]{1,80}$/u.test(id)) && new Set(ids).size === ids.length;
  if (doc.version !== 1 || !validIds(doc.rows) || !validIds(doc.columns) || doc.rows.length * doc.columns.length > MAX_TABLE_CELLS || !Array.isArray(doc.cells)) throw new Error(`표는 최대 ${MAX_TABLE_CELLS}칸까지 만들 수 있어요.`);
  if (doc.columnWidthLocks !== undefined) {
    const locks=doc.columnWidthLocks;
    if (!locks || typeof locks!=="object" || Array.isArray(locks) || Object.entries(locks).some(([id,width])=>!doc.columns.includes(id)||!Number.isFinite(width)||width<=0||width>1) || Object.values(locks).reduce((sum,width)=>sum+width,0)>1.00001) throw new Error("열 너비 고정 정보를 확인해 주세요.");
  }
  const occupied = new Set<string>();
  const ids = new Set<string>();
  const keywordIds = new Set<string>();
  for (const cell of doc.cells) {
    if (cell.textAlign !== undefined && !["left", "center", "right", "justify"].includes(cell.textAlign)) throw new Error("칸의 글자 정렬을 확인해 주세요.");
    const r = doc.rows.indexOf(cell.row), c = doc.columns.indexOf(cell.column);
    if (!/^[\w-]{1,80}$/u.test(cell.id) || ids.has(cell.id) || r < 0 || c < 0 || !Number.isInteger(cell.rowSpan) || !Number.isInteger(cell.colSpan) || cell.rowSpan < 1 || cell.colSpan < 1 || r + cell.rowSpan > doc.rows.length || c + cell.colSpan > doc.columns.length || typeof cell.format !== "string" || cell.format.length > 30000 || ![0,1,2,3].includes(cell.shade) || ![1,2,3].includes(cell.border)) throw new Error("표의 칸 구조가 올바르지 않아요.");
    ids.add(cell.id);
    const words = cellParts(cell.format).filter((part) => part.type === "blank");
    if (!Array.isArray(cell.keywordIds) || cell.keywordIds.length !== words.length) throw new Error("표 키워드 식별자를 확인해 주세요.");
    for (const id of cell.keywordIds) {
      if (!/^[\w-]{1,80}$/u.test(id) || keywordIds.has(id)) throw new Error("표 키워드가 중복되어 있어요.");
      keywordIds.add(id);
    }
    for (let y = r; y < r + cell.rowSpan; y++) for (let x = c; x < c + cell.colSpan; x++) {
      const position = `${y}:${x}`;
      if (occupied.has(position)) throw new Error("표에 겹친 칸이 있어요.");
      occupied.add(position);
    }
  }
  if (occupied.size !== doc.rows.length * doc.columns.length || keywordIds.size > MAX_KEYWORDS || JSON.stringify(doc).length > 500000) throw new Error("표 크기 또는 키워드 수를 줄여 주세요. 내용은 잘라서 저장하지 않아요.");
  return doc;
}

export function readTable(format: unknown): TableDocument | null {
  if (typeof format !== "string" || !isTableFormat(format)) return null;
  try { return validateTable(JSON.parse(format.slice(TABLE_PREFIX.length))); } catch { return null; }
}
export function encodeTable(doc: TableDocument) {
  // Legacy widths remain readable, but all new saves use the same thin border.
  // Keep cell/keyword IDs and content intact so learning records stay attached.
  const valid = validateTable(doc);
  return TABLE_PREFIX + JSON.stringify({...valid,cells:valid.cells.map(cell=>({...cell,border:1}))});
}
export function sortedCells(doc: TableDocument, columnFirst = false) {
  return [...doc.cells].sort((a,b) => columnFirst
    ? doc.columns.indexOf(a.column) - doc.columns.indexOf(b.column) || doc.rows.indexOf(a.row) - doc.rows.indexOf(b.row)
    : doc.rows.indexOf(a.row) - doc.rows.indexOf(b.row) || doc.columns.indexOf(a.column) - doc.columns.indexOf(b.column));
}
export function tableText(doc: TableDocument) { return doc.rows.map((row) => sortedCells(doc).filter((cell) => cell.row === row).map((cell) => plainCell(cell.format)).join("\t")).join("\n").trim(); }
export function tableParts(doc: TableDocument): TablePart[] {
  return sortedCells(doc).flatMap((cell) => {
    let index = 0;
    return cellParts(cell.format).map((part) => ({ ...part, cellId: cell.id, ...(part.type === "blank" ? { keywordId: `table:${cell.keywordIds[index++]}` } : {}) }));
  });
}
// Keep answer storage in its stable row-major order. Only navigation and the
// visible blank numbers follow the chosen direction, with one cell kept together.
export function tableBlankOrder(doc: TableDocument, parts: TablePart[], tabOrder: TableTabOrder = "vertical"): number[] {
  const byCell = new Map<string, number[]>();
  let blankIndex = 0;
  for (const part of parts) {
    if (part.type !== "blank") continue;
    if (part.cellId) {
      if (!byCell.has(part.cellId)) byCell.set(part.cellId, []);
      byCell.get(part.cellId)!.push(blankIndex);
    }
    blankIndex++;
  }
  return sortedCells(doc, tabOrder === "vertical").flatMap((cell) => byCell.get(cell.id) ?? []);
}

type BlankRect = { left: number; right: number; top: number; bottom: number };
export function tableBlankNavigation(
  doc: TableDocument, parts: TablePart[], activeIndices: number[], currentIndex: number,
  key: string, reverse = false, rectAt?: (index: number) => BlankRect | null,
  tabOrder: TableTabOrder = "vertical"
): number | null {
  const active = new Set(activeIndices);
  const order = tableBlankOrder(doc, parts).filter((index) => active.has(index));
  if (key === "Tab") {
    const tabIndices = tableBlankOrder(doc, parts, tabOrder).filter((index) => active.has(index));
    return tabIndices[tabIndices.indexOf(currentIndex) + (reverse ? -1 : 1)] ?? null;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return null;
  const blanks = parts.filter((part) => part.type === "blank");
  const cellId = blanks[currentIndex]?.cellId;
  if (!cellId) return null;
  const rect = rectAt?.(currentIndex);
  const sameCell = order.filter((index) => index !== currentIndex && blanks[index]?.cellId === cellId);
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  if (rect && rectAt) {
    const measured = sameCell.flatMap((index) => {
      const bounds = rectAt(index);
      return bounds ? [{ index, bounds }] : [];
    });
    const vertical = key === "ArrowUp" || key === "ArrowDown";
    if (vertical) {
      // First choose the nearest *visible line*, then the nearest position on
      // that line. Requiring horizontal overlap skips naturally staggered
      // blanks such as the last word on one line and the first on the next.
      const lines = measured.flatMap(({ index, bounds }) => {
        const gap = key === "ArrowDown" ? bounds.top - rect.bottom : rect.top - bounds.bottom;
        const horizontalGap = Math.max(0, bounds.left - rect.right, rect.left - bounds.right);
        const centerGap = Math.abs((bounds.left + bounds.right) - (rect.left + rect.right));
        return gap >= -1 ? [{ index, gap: Math.max(0, gap), horizontalGap, centerGap }] : [];
      }).sort((a,b) => a.gap - b.gap || a.horizontalGap - b.horizontalGap || a.centerGap - b.centerGap);
      if (lines.length) return lines[0].index;
    } else {
      const inLine = measured.flatMap(({ index, bounds }) => {
        const gap = key === "ArrowRight" ? bounds.left - rect.right : rect.left - bounds.right;
        return gap >= -1 && overlap(rect.top, rect.bottom, bounds.top, bounds.bottom) > 0
          ? [{ index, gap: Math.max(0, gap) }] : [];
      }).sort((a,b) => a.gap - b.gap);
      if (inLine.length) return inLine[0].index;
      if (key === "ArrowRight") {
        // At the end of a wrapped line, Right continues at the first blank
        // on the next line in this cell. Left at the start instead goes to
        // the adjacent table cell, matching the physical arrow direction.
        const nextLine = measured.filter(({ bounds }) => bounds.top >= rect.bottom - 1)
          .sort((a,b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
        if (nextLine.length) return nextLine[0].index;
      }
    }
  }
  // Without measured positions, adjacent blanks in one cell still move
  // naturally with the horizontal arrows.
  if (!rect && (key === "ArrowLeft" || key === "ArrowRight")) {
    const step = key === "ArrowRight" ? 1 : -1;
    const next = order[order.indexOf(currentIndex) + step];
    if (next !== undefined && blanks[next]?.cellId === cellId) return next;
  }
  const targetCell = tableNavigation(doc, order.map((index) => blanks[index].cellId!), cellId, key);
  if (!targetCell) return null;
  const candidates = order.filter((index) => blanks[index]?.cellId === targetCell);
  if (!rect || candidates.length < 2) return candidates[0] ?? null;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sourceColumn = doc.columns.indexOf(doc.cells.find((cell) => cell.id === cellId)!.column);
  const targetColumn = doc.columns.indexOf(doc.cells.find((cell) => cell.id === targetCell)!.column);
  // Right enters a different cell at its first keyword. Matching the old
  // caret's vertical position can otherwise jump into a later wrapped line.
  if (key === "ArrowRight") return candidates[0] ?? null;
  // A diagonal fallback means this column has no blank in the next row.
  // Enter the neighboring cell at its first blank rather than at whichever
  // word happens to be physically nearest to the old cell's edge.
  if (!horizontal && sourceColumn !== targetColumn) return candidates[0] ?? null;
  return candidates.sort((a,b) => {
    const ar = rectAt?.(a), br = rectAt?.(b);
    const score = (bounds: BlankRect | null | undefined) => {
      if (!bounds) return [Infinity, Infinity];
      const gap = key === "ArrowDown" ? bounds.top - rect.bottom
        : key === "ArrowUp" ? rect.top - bounds.bottom
        : key === "ArrowRight" ? bounds.left - rect.right : rect.left - bounds.right;
      const cross = horizontal
        ? Math.abs((bounds.top + bounds.bottom) - (rect.top + rect.bottom))
        : Math.abs((bounds.left + bounds.right) - (rect.left + rect.right));
      return [Math.max(0,gap), cross];
    };
    const [aGap,aCross] = score(ar), [bGap,bCross] = score(br);
    return aGap-bGap || aCross-bCross || order.indexOf(a)-order.indexOf(b);
  })[0] ?? null;
}
export function tableKeywords(format: string) {
  const doc = readTable(format);
  return doc ? tableParts(doc).flatMap((part) => part.type === "blank" ? [{ keyword: part.keyword, keywordKey: part.keywordId!, cellId: part.cellId! }] : []) : [];
}

export function editCell(doc: TableDocument, id: string, format: string): TableDocument {
  return { ...doc, cells: doc.cells.map((cell) => {
    if (cell.id !== id) return cell;
    const previous = cellParts(cell.format).flatMap((part) => part.type === "blank" ? [part.keyword] : []);
    const available = previous.map((word, index) => ({ word, id: cell.keywordIds[index], used: false }));
    const next = splitBoldLists(normalizeTableListKeywords(format));
    const keywordIds = cellParts(next).flatMap((part) => {
      if (part.type !== "blank") return [];
      const old = available.find((item) => !item.used && item.word === part.keyword);
      if (old) old.used = true;
      return [old?.id ?? tableId()];
    });
    return { ...cell, format: next, keywordIds };
  }) };
}

export function resizeTable(doc: TableDocument, axis: "row" | "column", index: number, remove = false): TableDocument {
  const ids = axis === "row" ? doc.rows : doc.columns;
  if (remove && ids.length === 1) throw new Error("마지막 행·열은 지울 수 없어요.");
  if (!remove && (ids.length + 1) * (axis === "row" ? doc.columns.length : doc.rows.length) > MAX_TABLE_CELLS) throw new Error(`최대 ${MAX_TABLE_CELLS}칸까지 만들 수 있어요.`);
  const nextIds = [...ids];
  if (remove) nextIds.splice(index, 1); else nextIds.splice(index, 0, tableId());
  const span = axis === "row" ? "rowSpan" : "colSpan";
  const cells = doc.cells.flatMap((cell) => {
    const start = ids.indexOf(cell[axis]);
    if (remove && start === index && cell[span] === 1) return [];
    if (remove && start <= index && index < start + cell[span]) return [{ ...cell, [axis]: start === index ? nextIds[index] : cell[axis], [span]: cell[span] - 1 }];
    if (!remove && start < index && index < start + cell[span]) return [{ ...cell, [span]: cell[span] + 1 }];
    return [{ ...cell }];
  });
  const next = { ...doc, [axis === "row" ? "rows" : "columns"]: nextIds, cells };
  if (axis === "column" && doc.columnWidthLocks) next.columnWidthLocks=fitColumnWidthLocks(next.columns,doc.columnWidthLocks);
  for (const [r,row] of next.rows.entries()) for (const [c,column] of next.columns.entries()) {
    const covered = cells.some((cell) => r >= next.rows.indexOf(cell.row) && r < next.rows.indexOf(cell.row) + cell.rowSpan && c >= next.columns.indexOf(cell.column) && c < next.columns.indexOf(cell.column) + cell.colSpan);
    if (!covered) cells.push({ id: tableId(), row, column, rowSpan: 1, colSpan: 1, format: "", keywordIds: [], shade: 0, border: 1 });
  }
  return validateTable(next);
}

export function removeSelectedTableAxis(doc: TableDocument, axis: "row" | "column", cellId: string): TableDocument {
  const cell = doc.cells.find((item) => item.id === cellId);
  if (!cell) throw new Error("삭제할 칸을 선택해 주세요.");
  const ids = axis === "row" ? doc.rows : doc.columns;
  const start = ids.indexOf(cell[axis]);
  const count = axis === "row" ? cell.rowSpan : cell.colSpan;
  if (count >= ids.length) throw new Error("마지막 행·열은 지울 수 없어요.");
  let next = doc;
  for (let i = 0; i < count; i++) next = resizeTable(next, axis, start, true);
  return next;
}

export function mergeCells(doc: TableDocument, selected: string[]): TableDocument {
  const cells = sortedCells(doc).filter((cell) => selected.includes(cell.id));
  if (cells.length < 2) throw new Error("Shift+클릭으로 병합할 칸을 두 개 이상 선택해 주세요.");
  const r0 = Math.min(...cells.map((cell) => doc.rows.indexOf(cell.row))), c0 = Math.min(...cells.map((cell) => doc.columns.indexOf(cell.column)));
  const r1 = Math.max(...cells.map((cell) => doc.rows.indexOf(cell.row) + cell.rowSpan)), c1 = Math.max(...cells.map((cell) => doc.columns.indexOf(cell.column) + cell.colSpan));
  if (cells.reduce((sum,cell) => sum + cell.rowSpan * cell.colSpan, 0) !== (r1-r0)*(c1-c0)) throw new Error("직사각형 영역을 선택해 주세요.");
  const merged = { ...cells[0], row: doc.rows[r0], column: doc.columns[c0], rowSpan: r1-r0, colSpan: c1-c0, format: cells.map((cell) => cell.format).filter(Boolean).join("\n"), keywordIds: cells.flatMap((cell) => cell.keywordIds) };
  return validateTable({ ...doc, cells: [...doc.cells.filter((cell) => !selected.includes(cell.id)), merged] });
}
export function unmergeCells(doc: TableDocument, selected: string[]): TableDocument {
  return validateTable({ ...doc, cells: doc.cells.flatMap((cell) => {
    if (!selected.includes(cell.id)) return [cell];
    return Array.from({length:cell.rowSpan}, (_,r) => Array.from({length:cell.colSpan}, (_,c) => ({ ...cell, id:r||c ? tableId():cell.id, row:doc.rows[doc.rows.indexOf(cell.row)+r], column:doc.columns[doc.columns.indexOf(cell.column)+c], rowSpan:1,colSpan:1,format:r||c ? "":cell.format,keywordIds:r||c ? []:cell.keywordIds }))).flat();
  }) });
}

export function tableNavigation(doc: TableDocument, cells: string[], cellId: string, key: string, reverse = false) {
  const available = sortedCells(doc, true).filter((cell) => cells.includes(cell.id));
  const current = doc.cells.find((cell) => cell.id === cellId);
  if (!current) return null;
  if (key === "Tab") return available[available.findIndex((cell) => cell.id === cellId) + (reverse ? -1 : 1)]?.id ?? null;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return null;
  const row = doc.rows.indexOf(current.row), column = doc.columns.indexOf(current.column);
  const candidates = available.filter((cell) => cell.id !== cellId).map((cell) => ({ cell, r:doc.rows.indexOf(cell.row), c:doc.columns.indexOf(cell.column) }));
  const vertical = key === "ArrowDown" || key === "ArrowUp";
  const forward = key === "ArrowDown" || key === "ArrowRight";
  return candidates.filter(({cell,r,c}) => vertical ? (forward ? r >= row+current.rowSpan : r+cell.rowSpan <= row) : (forward ? c >= column+current.colSpan : c+cell.colSpan <= column))
    .sort((a,b) => {
      const gap = (start:number,size:number,otherStart:number,otherSize:number) => Math.max(0,start-otherStart-otherSize+1,otherStart-start-size+1);
      const crossA = vertical ? gap(a.c,a.cell.colSpan,column,current.colSpan) : gap(a.r,a.cell.rowSpan,row,current.rowSpan);
      const crossB = vertical ? gap(b.c,b.cell.colSpan,column,current.colSpan) : gap(b.r,b.cell.rowSpan,row,current.rowSpan);
      return crossA-crossB || (vertical ? Math.abs(a.r-row)-Math.abs(b.r-row) : Math.abs(a.c-column)-Math.abs(b.c-column));
    })[0]?.cell.id ?? null;
}

// Editor movement is intentionally separate from quiz movement (Tab down columns).
export function tableEditorMove(doc: TableDocument, cellId: string, key: string, reverse = false) {
  const cell = doc.cells.find((item) => item.id === cellId);
  if (!cell) return null;
  const horizontal = key === "Tab";
  const direction = horizontal ? (reverse ? "ArrowLeft" : "ArrowRight") : key === "Enter" ? "ArrowDown" : key;
  const row = doc.rows.indexOf(cell.row), column = doc.columns.indexOf(cell.column);
  let r = row, c = column;
  if (direction === "ArrowRight") c += cell.colSpan;
  else if (direction === "ArrowLeft") c--;
  else if (direction === "ArrowDown") r += cell.rowSpan;
  else if (direction === "ArrowUp") r--;
  else return null;
  let next = doc;
  let addedAxis: "row" | "column" | undefined;
  if (c === doc.columns.length && horizontal && !reverse) {
    addedAxis = "column"; next = resizeTable(doc, "column", c);
  } else if (r === doc.rows.length && key === "Enter") {
    addedAxis = "row"; next = resizeTable(doc, "row", r);
  }
  const target = next.cells.find((item) => {
    const y = next.rows.indexOf(item.row), x = next.columns.indexOf(item.column);
    return y <= r && r < y + item.rowSpan && x <= c && c < x + item.colSpan;
  });
  return target ? { doc: next, targetId: target.id, addedAxis } : null;
}

export function removeEmptyTableAxis(doc: TableDocument, cellId: string, preferred: "row" | "column" = "row") {
  const cell = doc.cells.find((item) => item.id === cellId);
  if (!cell || plainCell(cell.format).trim()) return null;
  const r = doc.rows.indexOf(cell.row), c = doc.columns.indexOf(cell.column);
  for (const axis of [preferred, preferred === "row" ? "column" : "row"] as const) {
    const ids = axis === "row" ? doc.rows : doc.columns;
    const atEnd = axis === "row" ? c + cell.colSpan === doc.columns.length : r + cell.rowSpan === doc.rows.length;
    const index = axis === "row" ? r + cell.rowSpan - 1 : c + cell.colSpan - 1;
    const span = axis === "row" ? "rowSpan" : "colSpan";
    const contents = doc.cells.filter((item) => ids.indexOf(item[axis]) <= index && index < ids.indexOf(item[axis]) + item[span]);
    if (!atEnd || ids.length <= 1 || contents.some((item) => plainCell(item.format).trim())) continue;
    const next = resizeTable(doc, axis, index, true);
    const y = Math.min(axis === "row" ? Math.max(0, index - 1) : r, next.rows.length - 1);
    const x = Math.min(axis === "column" ? Math.max(0, index - 1) : c, next.columns.length - 1);
    const target = next.cells.find((item) => next.rows.indexOf(item.row) <= y && y < next.rows.indexOf(item.row) + item.rowSpan && next.columns.indexOf(item.column) <= x && x < next.columns.indexOf(item.column) + item.colSpan)!;
    return { doc: next, targetId: target.id };
  }
  return null;
}

// Store a share of the table width so content cannot resize a locked column,
// while another device can still fit the same table into its own viewport.
export function fitColumnWidthLocks(columns: string[], locks: Record<string, number>) {
  const entries=columns.flatMap(id=>locks[id]?[ [id,locks[id]] as const ]:[]);
  const total=entries.reduce((sum,[,width])=>sum+width,0);
  const all=entries.length===columns.length;
  const maximum=all?1:1-1/columns.length;
  const scale=all&&total ? 1/total : total>maximum ? maximum/total : 1;
  return Object.fromEntries(entries.map(([id,width])=>[id,width*scale]));
}

export function selectedTableColumns(doc: TableDocument, selected: string[]) {
  const ids=new Set(selected);
  const columns=new Set(doc.cells.filter(cell=>ids.has(cell.id)).flatMap(cell=>doc.columns.slice(doc.columns.indexOf(cell.column),doc.columns.indexOf(cell.column)+cell.colSpan)));
  return doc.columns.filter(id=>columns.has(id));
}

export function toggleTableColumnWidthLocks(doc: TableDocument, selected: string[], renderedWidths: number[]) {
  const columns=selectedTableColumns(doc,selected);
  if (!columns.length) return doc;
  const locks={...doc.columnWidthLocks};
  if (columns.every(id=>locks[id])) columns.forEach(id=>delete locks[id]);
  else {
    const total=renderedWidths.reduce((sum,width)=>sum+width,0);
    if (renderedWidths.length!==doc.columns.length||!Number.isFinite(total)||total<=0||renderedWidths.some(width=>!Number.isFinite(width)||width<=0)) throw new Error("표가 표시된 후 열 너비를 고정해 주세요.");
    columns.forEach(id=>{locks[id]=renderedWidths[doc.columns.indexOf(id)]/total;});
  }
  return validateTable({...doc,columnWidthLocks:locks});
}

export function equalizeTableColumnWidths(doc: TableDocument) {
  const width=1/doc.columns.length;
  if(doc.columns.every(id=>Math.abs((doc.columnWidthLocks?.[id]??0)-width)<1e-10))return doc;
  // An explicit whole-table command replaces prior width choices, including
  // locks, while keeping cell contents and learning identities untouched.
  return validateTable({...doc,columnWidthLocks:Object.fromEntries(doc.columns.map(id=>[id,width]))});
}

// Move an internal boundary, transferring space between its two neighbours.
// Keep the table's total width and every cell/keyword identity unchanged.
export function resizeTableColumnBoundary(doc: TableDocument, boundary: number, delta: number, widths: number[]) {
  if (!Number.isInteger(boundary)||boundary<0||boundary>=doc.columns.length-1||!Number.isFinite(delta)) return doc;
  const total=widths.reduce((sum,width)=>sum+width,0);
  if(widths.length!==doc.columns.length||!Number.isFinite(total)||total<=0||widths.some(width=>!Number.isFinite(width)||width<=0)) throw new Error("표가 표시된 후 열 너비를 조절해 주세요.");
  const pair=widths[boundary]+widths[boundary+1],minimum=Math.min(48,pair/3);
  const left=Math.max(minimum,Math.min(pair-minimum,widths[boundary]+delta));
  if(Math.abs(left-widths[boundary])<.01)return doc;
  const next=widths.map((width,index)=>index===boundary?left:index===boundary+1?pair-left:width);
  // Only the adjusted neighbours become locked. Refresh existing locks from
  // the same measurement to avoid rounding overflow when all tracks are locked.
  const locks=Object.fromEntries(doc.columns.flatMap((id,index)=>doc.columnWidthLocks?.[id]||index===boundary||index===boundary+1?[[id,next[index]/total]]:[]));
  return validateTable({...doc,columnWidthLocks:locks});
}

// Estimate natural line widths as column weights, not fixed rendered widths.
export function tableColumnWidths(doc: TableDocument, editing = false, measured: Record<string, number> = {}) {
  const widths = doc.columns.map(() => editing ? 76 : 56);
  for (const cell of [...doc.cells].sort((a,b) => a.colSpan - b.colSpan)) {
    const lineWidth = Math.max(0, ...plainCell(cell.format).split("\n").map((line) => Array.from(line).reduce((sum, char) => sum + (/[^\x00-\x7F]/u.test(char) ? 16 : 8), 0)));
    const desired = Math.max(editing ? 76 : 56, (measured[cell.id] ?? (lineWidth + (editing ? 20 : 0))) + 24);
    const start = doc.columns.indexOf(cell.column);
    const current = widths.slice(start, start + cell.colSpan).reduce((a,b) => a+b, 0);
    if (desired > current) for (let i=start; i<start+cell.colSpan; i++) widths[i] += (desired-current)/cell.colSpan;
  }
  return widths.map(Math.ceil);
}

// Share the available width without a fixed pixel minimum. Bound the weights so
// one very long description cannot squeeze every label column down to nothing.
function automaticColumnWeights(doc: TableDocument, editing = false, measured: Record<string, number> = {}, availableWidth = 0, editorTextWidths?: Record<string, number>) {
  const widths = tableColumnWidths(doc, editing, measured);
  const weights = widths.map(width => Math.max(80,Math.min(480,width)));
  let automatic=weights;
  if (editing && Number.isFinite(availableWidth) && availableWidth > 0) {
    const natural = editorTextWidths ? tableColumnWidths(doc,false,editorTextWidths) : widths;
    const total = weights.reduce((sum,width) => sum+width,0);
    const allocated = weights.map(width => availableWidth*width/total);
    const needingSpace = natural.map((width,index) => width>allocated[index]);
    const recipientWeight = weights.reduce((sum,width,index) => sum+(needingSpace[index]?width:0),0);
    if (recipientWeight) {
      // Halve only surplus space, not the label's text width. Longer columns
      // receive it; narrow screens retain the existing wrapping/fit behavior.
      const compact = allocated.map((width,index) => width-Math.max(0,width-natural[index])/2);
      const freed = allocated.reduce((sum,width,index) => sum+width-compact[index],0);
      if (freed > .01) automatic=compact.map((width,index) => width+(needingSpace[index]?freed*weights[index]/recipientWeight:0));
    }
  }
  return automatic;
}

export function tableColumnTracks(doc: TableDocument, editing = false, measured: Record<string, number> = {}, availableWidth = 0, editorTextWidths?: Record<string, number>) {
  const automatic=automaticColumnWeights(doc,editing,measured,availableWidth,editorTextWidths);
  const locks=doc.columnWidthLocks??{};
  const total=Object.values(locks).reduce((sum,width)=>sum+width,0);
  const all=doc.columns.every(id=>locks[id]);
  // Only unlocked columns share the remaining width; retain the compact
  // automatic proportions without jumping when the user first locks a column.
  return doc.columns.map((id,index)=>locks[id] ? `minmax(0, ${100*locks[id]/(all?total:1)}%)` : `minmax(0, ${automatic[index]}fr)`).join(" ");
}

// Resolve the editor's mixed percentage/fr tracks without changing the saved
// document. The full viewer must not independently reflow column proportions.
export function tableEditorColumnRatios(doc: TableDocument, availableWidth: number, textWidths?: Record<string, number>) {
  const weights=automaticColumnWeights(doc,true,{},availableWidth,textWidths),locks=doc.columnWidthLocks??{};
  const lockedTotal=Object.values(locks).reduce((sum,width)=>sum+width,0);
  const unlockedTotal=doc.columns.reduce((sum,id,index)=>sum+(locks[id]?0:weights[index]),0);
  return doc.columns.map((id,index)=>locks[id] ? locks[id]/(unlockedTotal?1:lockedTotal) : Math.max(0,1-lockedTotal)*weights[index]/unlockedTotal);
}

// The full-screen viewer uses intrinsic column widths, then enlarges the
// whole table only as far as its available width and height allow.
export function tableViewerFontSize(tableWidth: number, tableHeight: number, availableWidth: number, availableHeight: number, baseSize: number) {
  if ([tableWidth, tableHeight, availableWidth, availableHeight, baseSize].some((value) => !Number.isFinite(value) || value <= 0)) return baseSize;
  const scale = Math.min(1.75, (availableWidth - 8) / tableWidth, (availableHeight - 8) / tableHeight);
  return Math.max(baseSize, Math.floor(baseSize * scale * 10) / 10);
}

// On a phone, remove small, avoidable overflows without making a wide table
// illegible just to force it into a portrait viewport.
export function tableViewerMobileFontSize(tableWidth: number, tableHeight: number, availableWidth: number, availableHeight: number, baseSize: number) {
  if ([tableWidth, tableHeight, availableWidth, availableHeight, baseSize].some((value) => !Number.isFinite(value) || value <= 0)) return baseSize;
  const scale = Math.min(16.5 / baseSize, (availableWidth - 4) / tableWidth, (availableHeight - 4) / tableHeight);
  const fitted = Math.floor(baseSize * scale * 10) / 10;
  return fitted >= 12.5 ? fitted : baseSize;
}

export function tableEditorShortcut(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }) {
  if ((event.code === "F8" || event.key === "F8") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return "alignment";
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (!event.shiftKey && (event.code === "Backslash" || ["\\","₩"].includes(event.key))) return "widthLock";
  const key = /^Key[A-Z]$/u.test(event.code) ? event.code.slice(3).toLowerCase() : ({"ㅡ":"m","ㅔ":"p","ㅠ":"b","ㅋ":"z","ㅛ":"y"}[event.key] ?? event.key.toLowerCase());
  return key === "m" ? "merge" : key === "p" ? "shade" : key === "b" ? "bold" : key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
}

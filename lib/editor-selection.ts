import type { TableDocument } from "./table-card";

export type EditorSelectionMode = "single" | "toggle" | "range";

export function selectEditorItems(ids: string[], previous: string[], anchor: string | null, target: string, mode: EditorSelectionMode) {
  if (mode === "toggle") return previous.includes(target) ? previous.filter(id => id !== target) : [...previous, target];
  const start = anchor ? ids.indexOf(anchor) : -1;
  const end = ids.indexOf(target);
  return mode === "range" && start >= 0 && end >= 0
    ? ids.slice(Math.min(start, end), Math.max(start, end) + 1) : [target];
}

// Expand through intersecting merged cells so a selected rectangle never cuts
// a merged cell in half. IDs remain stable regardless of cell array order.
export function tableSelectionRange(doc: TableDocument, anchor: string | null, target: string) {
  const start = doc.cells.find(cell => cell.id === anchor);
  const end = doc.cells.find(cell => cell.id === target);
  if (!start || !end) return [target];
  const bounds = (cell: typeof start) => ({
    top: doc.rows.indexOf(cell.row), bottom: doc.rows.indexOf(cell.row) + cell.rowSpan,
    left: doc.columns.indexOf(cell.column), right: doc.columns.indexOf(cell.column) + cell.colSpan,
  });
  const a = bounds(start), b = bounds(end);
  let top = Math.min(a.top, b.top), bottom = Math.max(a.bottom, b.bottom);
  let left = Math.min(a.left, b.left), right = Math.max(a.right, b.right);
  const selected = new Set<string>();
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const cell of doc.cells) {
      const box = bounds(cell);
      if (box.top >= bottom || box.bottom <= top || box.left >= right || box.right <= left) continue;
      if (!selected.has(cell.id)) { selected.add(cell.id); expanded = true; }
      top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom);
      left = Math.min(left, box.left); right = Math.max(right, box.right);
    }
  }
  return doc.cells.filter(cell => selected.has(cell.id)).map(cell => cell.id);
}

export function desktopEditorSelection() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 760px) and (hover: hover) and (pointer: fine)").matches;
}

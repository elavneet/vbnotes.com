import type { Editor } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { TableMap, isInTable, moveTableColumn, selectedRect } from '@tiptap/pm/tables';

export type Align = 'left' | 'center' | 'right';

/** The table the caret is in: its size, the caret's row and column, and that column's alignment. */
export function tablePlace(state: EditorState) {
  if (!isInTable(state)) return null;
  const { top: row, left: col, map, table, tableStart } = selectedRect(state);
  const align = (table.nodeAt(map.map[row * map.width + col])?.attrs.align as Align | null | undefined) ?? null;
  return { row, col, rows: map.height, cols: map.width, map, table, tableStart, align };
}

/** The caret at the end of the cell in `row` and `col` of the table that starts at `tableStart`. */
function caretIn(tr: Transaction, tableStart: number, row: number, col: number) {
  const table = tr.doc.nodeAt(tableStart - 1);
  if (!table) return tr;
  const map = TableMap.get(table);
  const at = tableStart + map.map[row * map.width + col];
  const cell = tr.doc.nodeAt(at);
  return cell ? tr.setSelection(TextSelection.near(tr.doc.resolve(at + cell.nodeSize - 1), -1)) : tr;
}

/**
 * The caret's row changes places with the one above (-1) or below (1). The rows' words move, not
 * the rows themselves: the first row is the table's heading, and what moves into it becomes one.
 */
export function moveRow(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const p = tablePlace(state);
  const to = p ? p.row + dir : -1;
  if (!p || to < 0 || to >= p.rows) return false;
  const swaps: { at: number; old: PMNode; next: PMNode }[] = [];
  for (let c = 0; c < p.cols; c++) {
    const a = p.map.map[p.row * p.cols + c];
    const b = p.map.map[to * p.cols + c];
    const one = p.table.nodeAt(a);
    const other = p.table.nodeAt(b);
    if (!one || !other) return false;
    swaps.push({ at: a, old: one, next: other }, { at: b, old: other, next: one });
  }
  const tr = state.tr;
  // From the end of the table back, so the places still to change stay where they were.
  for (const s of swaps.sort((x, y) => y.at - x.at)) {
    const start = p.tableStart + s.at + 1;
    tr.replaceWith(start, start + s.old.content.size, s.next.content);
  }
  view.dispatch(caretIn(tr, p.tableStart, to, p.col).scrollIntoView());
  return true;
}

/** The caret's column changes places with the one to its left (-1) or right (1). */
export function moveColumn(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const p = tablePlace(state);
  const to = p ? p.col + dir : -1;
  if (!p || to < 0 || to >= p.cols) return false;
  return moveTableColumn({ from: p.col, to, select: false })(state, (tr) => view.dispatch(caretIn(tr, p.tableStart, p.row, to).scrollIntoView()));
}

/** The caret's whole column is aligned, as `| :-- |` in the file; null takes the alignment off. */
export function alignColumn(editor: Editor, align: Align | null): boolean {
  const { state, view } = editor;
  const p = tablePlace(state);
  if (!p) return false;
  const tr = state.tr;
  for (let r = 0; r < p.rows; r++) {
    const at = p.map.map[r * p.cols + p.col];
    const cell = p.table.nodeAt(at);
    if (cell) tr.setNodeMarkup(p.tableStart + at, null, { ...cell.attrs, align });
  }
  view.dispatch(tr);
  return true;
}

/** The caret's table as markdown, as HTML, or as plain text with a tab between cells. */
export function tableAs(editor: Editor, kind: 'md' | 'html' | 'text'): string {
  const p = tablePlace(editor.state);
  if (!p) return '';
  if (kind === 'md') return (editor.markdown?.serialize({ type: 'doc', content: [p.table.toJSON()] }) ?? '').trim();
  if (kind === 'html') {
    const box = document.createElement('div');
    box.appendChild(DOMSerializer.fromSchema(editor.schema).serializeNode(p.table));
    return box.innerHTML;
  }
  const rows: string[] = [];
  p.table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textBetween(0, cell.content.size, ' ').trim()));
    rows.push(cells.join('\t'));
  });
  return rows.join('\n');
}

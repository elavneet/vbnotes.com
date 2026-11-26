import { Extension, type Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

/** Where the caret's table, row and cell sit, when it is in a table. */
function cellAt($from: ResolvedPos) {
  for (let d = $from.depth; d > 1; d--) {
    if ($from.node(d - 1).type.name === 'tableRow' && $from.node(d - 2).type.name === 'table') return { cell: d, row: d - 1, table: d - 2 };
  }
  return null;
}

/** The caret on a line of its own at `at`, a place between two blocks: the empty line already there, or a new one. */
function lineAt(state: EditorState, at: number): Transaction {
  const next = state.doc.nodeAt(at);
  const tr = state.tr;
  if (!(next?.type.name === 'paragraph' && !next.content.size)) tr.insert(at, state.schema.nodes.paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView();
}

const isTable = (node: { type: { name: string } } | null | undefined) => node?.type.name === 'table';

/**
 * A table can be left where no line follows it: at the end of a note, and where the next block
 * is another table. Stock Tiptap gave ↓ on the last row nowhere to go at a note's end and took it
 * straight into the next table, and a click or tap in the space under a table put the caret in a
 * cell. Now ↓ from the last row's last line (↑ from the first row's first line, under another
 * table) and a click or tap in that space make a line there and put the caret on it.
 */
export const TableKeys = Extension.create({
  name: 'vbTableKeys',
  addKeyboardShortcuts() {
    const leave = (dir: 'up' | 'down') => ({ editor }: { editor: Editor }) => {
      const { state, view } = editor;
      const { $from, empty } = state.selection;
      const at = empty ? cellAt($from) : null;
      if (!at) return false;
      const table = $from.node(at.table);
      const cell = $from.node(at.cell);
      const down = dir === 'down';
      // From the table's edge row, and the cell's edge line.
      if ($from.index(at.table) !== (down ? table.childCount - 1 : 0) || $from.index(at.cell) !== (down ? cell.childCount - 1 : 0)) return false;
      if (!view.endOfTextblock(dir)) return false;
      const edge = down ? $from.after(at.table) : $from.before(at.table);
      const $edge = state.doc.resolve(edge);
      // Only where the caret has no line to go to: nothing follows, or another table does.
      const beyond = down ? $edge.nodeAfter : $edge.nodeBefore;
      if (down ? beyond && !isTable(beyond) : !isTable(beyond)) return false;
      view.dispatch(lineAt(state, edge));
      return true;
    };
    return { ArrowDown: leave('down'), ArrowUp: leave('up') };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (view) => {
          // The space between and under the note's blocks belongs to the editor or to the boxes it scrolls in.
          const ownSpace = (target: EventTarget | null) => {
            let el: HTMLElement | null = view.dom;
            for (let i = 0; el && i < 4; i++, el = el.parentElement) if (el === target) return el !== document.body;
            return false;
          };
          const onClick = (e: MouseEvent) => {
            const { state } = view;
            if (!view.editable || !ownSpace(e.target)) return;
            // The table the click is under, with nothing or another table below the click.
            let at = -1;
            state.doc.forEach((node, pos, i) => {
              if (at >= 0 || !isTable(node)) return;
              const next = i + 1 < state.doc.childCount ? state.doc.child(i + 1) : null;
              if (next && !isTable(next)) return;
              const dom = view.nodeDOM(pos);
              const below = next ? view.nodeDOM(pos + node.nodeSize) : null;
              if (!(dom instanceof HTMLElement) || e.clientY <= dom.getBoundingClientRect().bottom) return;
              if (below instanceof HTMLElement && e.clientY >= below.getBoundingClientRect().top) return;
              at = pos + node.nodeSize;
            });
            if (at < 0) return;
            e.preventDefault();
            view.dispatch(lineAt(state, at));
            view.focus();
          };
          document.addEventListener('click', onClick);
          return { destroy: () => document.removeEventListener('click', onClick) };
        },
      }),
    ];
  },
});

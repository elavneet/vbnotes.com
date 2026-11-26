import { Extension } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

/** Where the caret's table, row and cell sit, when it is in a table. */
function cellAt($from: ResolvedPos) {
  for (let d = $from.depth; d > 1; d--) {
    if ($from.node(d - 1).type.name === 'tableRow' && $from.node(d - 2).type.name === 'table') return { cell: d, row: d - 1, table: d - 2 };
  }
  return null;
}

/** The caret on a line of its own right under the table: the empty line already there, or a new one. */
function lineBelow(state: EditorState, $from: ResolvedPos, table: number): Transaction {
  const after = $from.after(table);
  const next = state.doc.nodeAt(after);
  const tr = state.tr;
  if (!(next?.type.name === 'paragraph' && !next.content.size)) tr.insert(after, state.schema.nodes.paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
}

/**
 * A table that ends a note can be left: stock Tiptap gave ↓ on its last row nowhere to go, and a
 * click or tap under it put the caret back in the last cell. ↓ from the last row's last line, and a
 * click or tap in the space under the table, now make a line under it and put the caret there.
 */
export const TableKeys = Extension.create({
  name: 'vbTableKeys',
  addKeyboardShortcuts() {
    return {
      ArrowDown: ({ editor }) => {
        const { state, view } = editor;
        const { $from, empty } = state.selection;
        const at = empty ? cellAt($from) : null;
        if (!at || $from.index(at.table) !== $from.node(at.table).childCount - 1) return false;
        // Only where nothing follows the table, and from the cell's last line.
        if ($from.after(at.table) !== state.doc.content.size || !view.endOfTextblock('down')) return false;
        if ($from.index(at.cell) !== $from.node(at.cell).childCount - 1) return false;
        view.dispatch(lineBelow(state, $from, at.table));
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (view) => {
          // The space under the note's last block belongs to the editor or to the boxes it scrolls in.
          const ownSpace = (target: EventTarget | null) => {
            let el: HTMLElement | null = view.dom;
            for (let i = 0; el && i < 4; i++, el = el.parentElement) if (el === target) return el !== document.body;
            return false;
          };
          const onClick = (e: MouseEvent) => {
            const { state } = view;
            const last = state.doc.lastChild;
            if (!view.editable || last?.type.name !== 'table' || !ownSpace(e.target)) return;
            const start = state.doc.content.size - last.nodeSize;
            const dom = view.nodeDOM(start);
            if (!(dom instanceof HTMLElement) || e.clientY <= dom.getBoundingClientRect().bottom) return;
            e.preventDefault();
            view.dispatch(lineBelow(state, state.doc.resolve(start + 1), 1));
            view.focus();
          };
          document.addEventListener('click', onClick);
          return { destroy: () => document.removeEventListener('click', onClick) };
        },
      }),
    ];
  },
});

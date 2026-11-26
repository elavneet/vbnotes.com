import { Extension, type Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { sendMessage } from '@10play/tentap-editor';
import type {} from '@tiptap/extension-table';
import { TableAction, tablePage, type TableOp } from '../src/editor/tableBridge';
import { alignColumn, moveColumn, moveRow, tableAs, tablePlace } from './tableEdits';

const ALIGN = { alignLeft: 'left', alignCenter: 'center', alignRight: 'right' } as const;

/** What the app's table menu picked; a copy returns the text for the app to put on the clipboard. */
tablePage.run = (e, op: TableOp) => {
  const editor = e as Editor;
  switch (op) {
    case 'copyMd': return tableAs(editor, 'md');
    case 'copyHtml': return tableAs(editor, 'html');
    case 'copyText': return tableAs(editor, 'text');
    case 'addRow': editor.chain().focus().addRowAfter().run(); break;
    case 'addColumn': editor.chain().focus().addColumnAfter().run(); break;
    case 'deleteRow': editor.chain().focus().deleteRow().run(); break;
    case 'deleteColumn': editor.chain().focus().deleteColumn().run(); break;
    case 'rowUp': case 'rowDown': editor.commands.focus(); moveRow(editor, op === 'rowUp' ? -1 : 1); break;
    case 'columnLeft': case 'columnRight': editor.commands.focus(); moveColumn(editor, op === 'columnLeft' ? -1 : 1); break;
    default: {
      editor.commands.focus();
      const align = ALIGN[op];
      // Picking the column's own alignment again takes it off.
      alignColumn(editor, tablePlace(editor.state)?.align === align ? null : align);
    }
  }
};

/**
 * The phone's way into a table's menu: a ⋮ in the corner of the cell the caret is in (there is no
 * pointer to hover with). Tapping it tells the app where the caret is, and the app shows the menu.
 */
export const TableDots = Extension.create({
  name: 'vbTableDots',
  addProseMirrorPlugins() {
    const editor = this.editor;
    const dots = () => {
      const el = document.createElement('span');
      el.className = 'vb-tdots';
      el.contentEditable = 'false';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Table');
      // Three dots, drawn by the stylesheet. The tap must not move the caret or drop the keyboard.
      el.appendChild(document.createElement('i'));
      const keep = (e: Event) => e.preventDefault();
      el.addEventListener('mousedown', keep);
      el.addEventListener('touchstart', keep, { passive: false });
      const open = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const p = tablePlace(editor.state);
        if (p) sendMessage({ type: TableAction.Menu, payload: { row: p.row, col: p.col, rows: p.rows, cols: p.cols, align: p.align } } as never);
      };
      el.addEventListener('touchend', open);
      el.addEventListener('click', open);
      return el;
    };
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const { $from, empty } = state.selection;
            if (!empty || !editor.isEditable) return null;
            for (let d = $from.depth; d > 0; d--) {
              const role = $from.node(d).type.spec.tableRole;
              if (role === 'cell' || role === 'header_cell') {
                return DecorationSet.create(state.doc, [Decoration.widget($from.start(d), dots, { side: -1, key: 'vb-tdots', ignoreSelection: true })]);
              }
            }
            return null;
          },
        },
      }),
    ];
  },
});

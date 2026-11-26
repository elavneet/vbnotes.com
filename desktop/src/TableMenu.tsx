import React, { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { type Align, alignColumn, moveColumn, moveRow, tableAs, tablePlace } from '../../editor-web/tableEdits';
import { Icon } from './Icon';

const MAC = /Mac/.test(navigator.platform);
type Item = { label: string; keys?: string; check?: boolean; disabled?: boolean; run?: () => unknown; sub?: Item[] } | 'line';

/** Where the ⋮ sits in the scrolling box: the top right corner of the cell under the pointer. */
type Dots = { cell: HTMLElement; left: number; top: number };

/**
 * A table's ⋮: it shows in the cell under the pointer, and opens the table's menu for that cell
 * (copy the table, align the column, add, move and delete rows and columns), each with its key.
 */
export function TableMenu({ editor, scroll }: { editor: Editor | null; scroll: React.RefObject<HTMLDivElement | null> }) {
  const [dots, setDots] = useState<Dots | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const box = scroll.current;
    if (!editor || !box) return;
    const over = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.table-dots')) return;
      const cell = target?.closest<HTMLElement>('td, th') ?? null;
      if (!cell || !editor.view.dom.contains(cell) || !editor.isEditable) { setDots(null); return; }
      const c = cell.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setDots((was) => (was?.cell === cell ? was : { cell, left: c.right - b.left + box.scrollLeft - 24, top: c.top - b.top + box.scrollTop + 7 }));
    };
    const out = () => setDots(null);
    box.addEventListener('mousemove', over);
    box.addEventListener('mouseleave', out);
    return () => { box.removeEventListener('mousemove', over); box.removeEventListener('mouseleave', out); };
  }, [editor, scroll]);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== 'Escape') return; setAt(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    scroll.current?.addEventListener('scroll', close);
    const box = scroll.current;
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
      box?.removeEventListener('scroll', close);
    };
  }, [at, scroll]);

  if (!editor) return null;

  // The menu is about the cell whose ⋮ was pressed: the caret goes there unless it already is.
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (at) { setAt(null); return; }
    if (!dots) return;
    const { state, view } = editor;
    const inside = view.posAtDOM(dots.cell, 0);
    const cell = state.doc.resolve(inside).parent;
    if (state.selection.from < inside || state.selection.to > inside + cell.content.size) {
      view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(inside + cell.content.size), -1)));
    }
    view.focus();
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 470)) });
  };

  const p = at ? tablePlace(editor.state) : null;
  const copy = (kind: 'md' | 'html' | 'text') => () => {
    const text = tableAs(editor, kind);
    const item: Record<string, Blob> = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
    if (kind === 'html') item['text/html'] = new Blob([text], { type: 'text/html' });
    return navigator.clipboard.write([new ClipboardItem(item)]);
  };
  const align = (a: Align) => ({ label: a[0].toUpperCase() + a.slice(1), check: p?.align === a, run: () => alignColumn(editor, p?.align === a ? null : a) });
  const key = (mac: string, other = '') => (MAC ? mac : other);
  const items: Item[] = p ? [
    { label: 'Copy Table As', sub: [{ label: 'Markdown', run: copy('md') }, { label: 'HTML', run: copy('html') }, { label: 'Plain Text', run: copy('text') }] },
    'line',
    { label: 'Align Column', sub: [align('left'), align('center'), align('right')] },
    'line',
    { label: 'Add Row', keys: key('⌃⌘▼'), run: () => editor.chain().focus().addRowAfter().run() },
    { label: 'Add Row Above', keys: key('⌃⌘▲'), disabled: p.row === 0, run: () => editor.chain().focus().addRowBefore().run() },
    { label: 'Add Column', keys: key('⌃⌘▶'), run: () => editor.chain().focus().addColumnAfter().run() },
    { label: 'Add Column Before', keys: key('⌃⌘◀'), run: () => editor.chain().focus().addColumnBefore().run() },
    'line',
    { label: 'Move Row Up', keys: key('⌥⌘▲', 'Ctrl+Alt+↑'), disabled: p.row === 0, run: () => moveRow(editor, -1) },
    { label: 'Move Row Down', keys: key('⌥⌘▼', 'Ctrl+Alt+↓'), disabled: p.row === p.rows - 1, run: () => moveRow(editor, 1) },
    { label: 'Move Column Left', keys: key('⌥⌘◀', 'Ctrl+Alt+←'), disabled: p.col === 0, run: () => moveColumn(editor, -1) },
    { label: 'Move Column Right', keys: key('⌥⌘▶', 'Ctrl+Alt+→'), disabled: p.col === p.cols - 1, run: () => moveColumn(editor, 1) },
    'line',
    { label: 'Delete Row', keys: key('⌃⌘⌫'), disabled: p.row === 0, run: () => editor.chain().focus().deleteRow().run() },
    { label: 'Delete Column', keys: key('⌃⇧⌘⌫'), disabled: p.cols < 2, run: () => editor.chain().focus().deleteColumn().run() },
  ] : [];

  // Run at once: WebKit lets a click write to the clipboard only while the click is handled.
  const pick = (run: () => unknown) => () => {
    setAt(null);
    setDots(null);
    try {
      void Promise.resolve(run()).catch((e) => console.warn('table menu', e));
    } catch (e) {
      console.warn('table menu', e);
    }
  };
  // Sub menus open to the right while there is room for them.
  const sideways = at && at.left + 500 < window.innerWidth ? ' menu-sub-right' : '';
  const list = (rows: Item[]) => {
    const tick = rows.some((i) => i !== 'line' && i.check !== undefined);
    return rows.map((i, n) => {
      if (i === 'line') return <hr key={n} />;
      const row = (
        <>
          {tick ? <span className="mi-check">{i.check ? <Icon name="check" size={14} weight={2.4} /> : null}</span> : null}
          <span className="mi-label">{i.label}</span>
          {i.keys ? <span className="mi-keys">{i.keys}</span> : null}
        </>
      );
      if (i.sub) {
        return (
          <div key={i.label} className={`menu-sub${sideways}`}>
            <button className="menu-has-sub">{row}<Icon name="chevron" size={13} className="mi-more" /></button>
            <div className="menu note-menu">{list(i.sub)}</div>
          </div>
        );
      }
      return <button key={i.label} disabled={i.disabled} onClick={pick(i.run!)}>{row}</button>;
    });
  };
  // Mouse-downs here never reach the editor, so the caret and the note's focus stay as they are.
  const keep = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <>
      {dots || at ? (
        <button className={`table-dots${at ? ' on' : ''}`} style={dots ? { left: dots.left, top: dots.top } : { display: 'none' }} onMouseDown={keep} onClick={open} title="Table" aria-label="Table" aria-expanded={!!at}>
          <Icon name="more" size={16} weight={3} />
        </button>
      ) : null}
      {at && p ? <div className="menu note-menu table-menu" style={{ left: at.left, top: at.top }} onMouseDown={keep}>{list(items)}</div> : null}
    </>
  );
}

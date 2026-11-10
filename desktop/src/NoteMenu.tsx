import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { openEditor } from './NoteEditor';
import { REVEAL_LABEL, copyNoteAs, copyNoteLink, exportNote, printNote, revealNote } from './noteExport';
import { useNotes } from './store';

type Item = { label: string; danger?: boolean; run?: () => unknown; sub?: Item[] } | 'line';

/** The note's ⋮ menu, as in Bear: Export and Copy As (each with its formats), Copy Link, Print, the file, Trash. */
export function NoteMenu({ path }: { path: string }) {
  const [at, setAt] = useState<{ right: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const section = useNotes((s) => s.section);
  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== 'Escape') return; setAt(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); window.removeEventListener('blur', close); };
  }, [at]);
  const toggle = () => {
    const r = button.current!.getBoundingClientRect();
    setAt(at ? null : { right: window.innerWidth - r.right, top: r.bottom + 6 });
  };
  const { trash, restore, deleteForever } = useNotes.getState();
  const leave = (fn: (p: string) => Promise<unknown>) => async () => { await openEditor.flush(); await fn(path); };
  const items: Item[] = [
    { label: 'Export', sub: [
      { label: 'Markdown…', run: () => exportNote(path, 'md') },
      { label: 'HTML…', run: () => exportNote(path, 'html') },
      { label: 'PDF…', run: () => printNote(path) },
    ] },
    { label: 'Copy As', sub: [
      { label: 'Markdown', run: () => copyNoteAs(path, 'md') },
      { label: 'HTML', run: () => copyNoteAs(path, 'html') },
      { label: 'Plain Text', run: () => copyNoteAs(path, 'text') },
    ] },
    { label: 'Copy Link', run: () => copyNoteLink(path) },
    { label: 'Print…', run: () => printNote(path) },
    'line',
    { label: REVEAL_LABEL, run: () => revealNote(path) },
    'line',
    ...(section === 'trash'
      ? [{ label: 'Restore', run: leave(restore) }, { label: 'Delete forever', danger: true, run: leave(deleteForever) }]
      : [{ label: 'Move to Trash', danger: true, run: leave(trash) }]),
  ];
  // Run at once: WebKit lets a click write to the clipboard only while the click is handled.
  const pick = (run: () => unknown) => () => {
    setAt(null);
    try {
      void Promise.resolve(run()).catch((e) => console.warn('note menu', e));
    } catch (e) {
      console.warn('note menu', e);
    }
  };
  const list = (items: Item[]) => items.map((i, n) => {
    if (i === 'line') return <hr key={n} />;
    if (i.sub) {
      return (
        <div key={i.label} className="menu-sub">
          <button className="menu-has-sub">{i.label}<Icon name="chevron" size={12} /></button>
          <div className="menu">{list(i.sub)}</div>
        </div>
      );
    }
    return <button key={i.label} className={i.danger ? 'danger' : undefined} onClick={pick(i.run!)}>{i.label}</button>;
  });
  return (
    <>
      <button ref={button} className={`icon-btn${at ? ' on' : ''}`} onClick={toggle} onMouseDown={(e) => e.stopPropagation()} title="More" aria-label="More" aria-expanded={!!at}>
        <Icon name="more" weight={3} />
      </button>
      {at ? <div className="menu note-menu" style={{ right: at.right, top: at.top }} onMouseDown={(e) => e.stopPropagation()}>{list(items)}</div> : null}
    </>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { useInfo } from './InfoPanel';
import { useLayout } from './layout';
import { openEditor } from './NoteEditor';
import { REVEAL_LABEL, copyNoteAs, copyNoteLink, exportNote, printNote, revealNote } from './noteExport';
import { useNote, useNotes } from './store';

type Item = { label: string; icon?: IconName; check?: boolean; disabled?: boolean; danger?: boolean; run?: () => unknown; sub?: Item[] } | 'line';

/**
 * The note's ⋮ menu, laid out as: Statistics, the three layouts, Export, Copy As and Copy
 * Link, Delete and Restore, and More (pin, bookmark, print, the file).
 */
export function NoteMenu({ path }: { path: string }) {
  const [at, setAt] = useState<{ right: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const section = useNotes((s) => s.section);
  const marked = useNotes((s) => s.bookmarks.includes(path));
  const note = useNote(path);
  const { layout, set: setLayout } = useLayout();
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
    setAt(at ? null : { right: window.innerWidth - r.right, top: r.bottom + 8 });
  };
  const { trash, restore, deleteForever, togglePin, toggleBookmark } = useNotes.getState();
  const leave = (fn: (p: string) => Promise<unknown>) => async () => { await openEditor.flush(); await fn(path); };
  const inTrash = section === 'trash';
  const items: Item[] = [
    { label: 'Toggle Statistics', icon: 'stats', run: () => useInfo.getState().toggle() },
    'line',
    { label: 'Show Editor Only', icon: 'editorOnly', check: layout === 'editor', run: () => setLayout('editor') },
    { label: 'Show Notes and Editor', icon: 'sidebar', check: layout === 'notes', run: () => setLayout('notes') },
    { label: 'Show Tags, Notes and Editor', icon: 'threePanes', check: layout === 'all', run: () => setLayout('all') },
    'line',
    { label: 'Export', icon: 'export', sub: [
      { label: 'Markdown…', run: () => exportNote(path, 'md') },
      { label: 'HTML…', run: () => exportNote(path, 'html') },
      { label: 'PDF…', run: () => printNote(path) },
    ] },
    { label: 'Copy As', icon: 'copy', sub: [
      { label: 'Markdown', run: () => copyNoteAs(path, 'md') },
      { label: 'HTML', run: () => copyNoteAs(path, 'html') },
      { label: 'Plain Text', run: () => copyNoteAs(path, 'text') },
    ] },
    { label: 'Copy Link', icon: 'link', run: () => copyNoteLink(path) },
    'line',
    inTrash
      ? { label: 'Delete Forever', icon: 'trash', danger: true, run: leave(deleteForever) }
      : { label: 'Delete', icon: 'trash', run: leave(trash) },
    { label: section === 'archive' ? 'Move to Notes' : 'Restore', icon: 'restore', disabled: section === 'notes', run: leave(restore) },
    'line',
    { label: 'More', icon: 'dots', sub: [
      ...(inTrash ? [] : [
        { label: note?.pinned ? 'Unpin' : 'Pin to Top', icon: 'pin', run: leave(togglePin) } as Item,
        ...(section === 'notes' ? [{ label: marked ? 'Remove Bookmark' : 'Bookmark', icon: 'bookmark', run: leave(toggleBookmark) } as Item] : []),
        'line' as const,
      ]),
      { label: 'Print…', icon: 'print', run: () => printNote(path) },
      { label: REVEAL_LABEL, icon: 'folder', run: () => revealNote(path) },
    ] },
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
  const checks = (list: Item[]) => list.some((i) => i !== 'line' && i.check !== undefined);
  const row = (i: Exclude<Item, 'line'>, tick: boolean) => (
    <>
      {tick ? <span className="mi-check">{i.check ? <Icon name="check" size={14} weight={2.4} /> : null}</span> : null}
      {i.icon ? <Icon name={i.icon} size={17} className="mi-icon" /> : null}
      <span className="mi-label">{i.label}</span>
    </>
  );
  const list = (items: Item[]) => {
    const tick = checks(items);
    return items.map((i, n) => {
      if (i === 'line') return <hr key={n} />;
      if (i.sub) {
        return (
          <div key={i.label} className="menu-sub">
            <button className="menu-has-sub">{row(i, tick)}<Icon name="chevron" size={13} className="mi-more" /></button>
            <div className="menu note-menu">{list(i.sub)}</div>
          </div>
        );
      }
      return <button key={i.label} className={i.danger ? 'danger' : undefined} disabled={i.disabled} onClick={pick(i.run!)}>{row(i, tick)}</button>;
    });
  };
  return (
    <>
      <button ref={button} className={`icon-btn${at ? ' on' : ''}`} onClick={toggle} onMouseDown={(e) => e.stopPropagation()} title="More" aria-label="More" aria-expanded={!!at}>
        <Icon name="more" weight={3} />
      </button>
      {at ? <div className="menu note-menu" style={{ right: at.right, top: at.top }} onMouseDown={(e) => e.stopPropagation()}>{list(items)}</div> : null}
    </>
  );
}

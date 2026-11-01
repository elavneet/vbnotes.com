import React, { useEffect, useMemo, useRef, useState } from 'react';
import { UNTAGGED, type NoteMeta } from '@/store/noteModel';
import { dateGroup, formatNoteDate } from '@/utils/dates';
import { tagHue } from '@/utils/tags';
import { Icon } from './Icon';
import { openEditor } from './NoteEditor';
import { useFileDrop } from './fileDrop';
import { useDrawer } from './Sidebar';
import { useMeaning } from './meaning';
import { useNoteList, useNotes } from './store';

/** Rows read from the index at a time; scrolling near the end reads the next ones. */
const PAGE = 200;
const TITLES = { notes: 'Notes', archive: 'Archive', trash: 'Trash' } as const;

type Group = { title: string; notes: NoteMeta[] };

/** Pinned first, then Today, Yesterday, This week and one group per month (as on the phone). */
function groupNotes(list: NoteMeta[]): Group[] {
  const out: Group[] = [];
  const pinned = list.filter((n) => n.pinned);
  if (pinned.length) out.push({ title: 'Pinned', notes: pinned });
  const now = Date.now();
  for (const n of list) {
    if (n.pinned) continue;
    const title = dateGroup(n.mtime, now);
    const last = out[out.length - 1];
    if (last && last.title === title && last.title !== 'Pinned') last.notes.push(n); else out.push({ title, notes: [n] });
  }
  return out;
}

type Menu = { x: number; y: number; note: NoteMeta };

export function NoteList({ searchRef, onCreate }: { searchRef: React.RefObject<HTMLInputElement | null>; onCreate: () => void }) {
  const { section, tag, selected, select } = useNotes();
  const scanned = useNotes((s) => s.scanned);
  const [query, setQuery] = useState('');
  // The list searches a moment after typing stops: a search by meaning takes a little longer.
  const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(query), query ? 150 : 0); return () => clearTimeout(t); }, [query]);
  const meaningOn = useMeaning((s) => s.on);
  const filter = `${section}:${tag}:${search}`;
  const [page, setPage] = useState({ filter, limit: PAGE });
  const limit = page.filter === filter ? page.limit : PAGE;
  const { notes, snippets, meaning } = useNoteList(section, tag, search, limit);
  const groups = useMemo(() => (search.trim() ? [{ title: `${notes.length} found`, notes }] : groupNotes(notes)), [notes, search]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const dropping = useFileDrop(paneRef);

  // A new filter starts at the top.
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [section, tag]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 1200 && notes.length >= limit) setPage({ filter, limit: limit + PAGE });
  };

  // ↑ and ↓ walk the list; ⌘⌫ (Ctrl+Backspace) moves the selected note to Trash, as in Bear.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const flat = groups.flatMap((g) => g.notes);
    const i = flat.findIndex((n) => n.path === selected);
    if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey) && selected && section !== 'trash') {
      e.preventDefault();
      const next = flat[i + 1] ?? flat[i - 1];
      void openEditor.flush().then(() => useNotes.getState().trash(selected)).then(() => select(next && next.path !== selected ? next.path : null));
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) select(next.path);
  };

  const title = tag === UNTAGGED ? 'Untagged' : tag ? `#${tag}` : TITLES[section];
  const empty = !scanned ? 'Opening your notes…' : query ? 'No notes match.' : tag === UNTAGGED ? 'Every note has a tag.' : tag ? `Nothing tagged #${tag} yet.` : section === 'notes' ? 'A blank page. Write the first note (⌘N).' : `${TITLES[section]} is empty.`;

  return (
    <section className={`list-pane${dropping ? ' dropping' : ''}`} ref={paneRef}>
      <header className="list-head" data-tauri-drag-region>
        <button className="icon-btn narrow-only" onClick={() => useDrawer.getState().set(true)} title="Show the library" aria-label="Show the library"><Icon name="sidebar" /></button>
        <h2 data-tauri-drag-region>{title}</h2>
        {section === 'notes' ? (
          <button className="icon-btn volt" onClick={onCreate} title="New note (⌘N)" aria-label="New note"><Icon name="plus" /></button>
        ) : null}
      </header>
      <label className="search">
        <Icon name="search" size={16} />
        <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={meaningOn ? 'Search or ask (⌘F)' : 'Search (⌘F)'} spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} />
      </label>
      <div className="list" ref={listRef} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown}>
        {notes.length === 0 ? <p className="list-empty">{empty}</p> : null}
        {groups.map((g) => (
          <div key={g.title}>
            <h3 className="group">{g.title}</h3>
            {g.notes.map((n) => (
              <Row key={n.path} note={n} snippet={snippets?.get(n.path)} byMeaning={!!meaning?.has(n.path)} selected={n.path === selected}
                onOpen={() => select(n.path)}
                onMenu={(e) => { e.preventDefault(); select(n.path); setMenu({ x: e.clientX, y: e.clientY, note: n }); }} />
            ))}
          </div>
        ))}
      </div>
      {menu ? <RowMenu menu={menu} onClose={() => setMenu(null)} /> : null}
      {dropping ? (
        <div className="drop-hint">
          <Icon name="plus" size={26} />
          <strong>Drop to add to your notes</strong>
          <span>Notes, pictures, sound or a whole folder</span>
        </div>
      ) : null}
    </section>
  );
}

const Row = React.memo(function Row({ note, snippet, byMeaning, selected, onOpen, onMenu }: {
  note: NoteMeta; snippet?: string; byMeaning: boolean; selected: boolean; onOpen: () => void; onMenu: (e: React.MouseEvent) => void;
}) {
  const text = snippet ?? note.preview;
  return (
    <button className={`row${selected ? ' selected' : ''}`} onClick={onOpen} onContextMenu={onMenu}>
      <span className="row-top">
        {note.pinned ? <Icon name="pin" size={14} className="row-pin" /> : null}
        {byMeaning ? <span title="Found by meaning"><Icon name="sparkle" size={14} className="row-meaning" /></span> : null}
        <span className="row-title">{note.title || 'Untitled'}</span>
        <span className="row-time">{formatNoteDate(note.mtime)}</span>
      </span>
      {text ? <span className="row-text">{text}</span> : null}
      {note.tags.length ? (
        <span className="row-tags">
          {note.tags.slice(0, 4).map((t) => <span key={t} className="chip vb-tag" data-hue={tagHue(t)}>#{t}</span>)}
        </span>
      ) : null}
    </button>
  );
});

/** Right-click on a note: what the phone's long press offers. */
function RowMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const { section, togglePin, archive, trash, restore, deleteForever } = useNotes.getState();
  const { note } = menu;
  const run = (fn: (p: string) => Promise<unknown>) => async () => { onClose(); await openEditor.flush(); await fn(note.path); };
  const items: { label: string; danger?: boolean; onClick: () => void }[] = section === 'trash'
    ? [{ label: 'Restore', onClick: run(restore) }, { label: 'Delete forever', danger: true, onClick: run(deleteForever) }]
    : [
        { label: note.pinned ? 'Unpin' : 'Pin to top', onClick: run(togglePin) },
        section === 'archive' ? { label: 'Move to Notes', onClick: run(restore) } : { label: 'Archive', onClick: run(archive) },
        { label: 'Move to Trash', danger: true, onClick: run(trash) },
      ];
  useEffect(() => {
    const close = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== 'Escape') return; onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); window.removeEventListener('blur', close); };
  }, [onClose]);
  return (
    <div className="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 140) }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((i) => <button key={i.label} className={i.danger ? 'danger' : undefined} onClick={i.onClick}>{i.label}</button>)}
    </div>
  );
}

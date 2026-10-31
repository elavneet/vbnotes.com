import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { NoteMeta } from '@/store/noteModel';
import { formatNoteDate } from '@/utils/dates';
import { Icon } from './Icon';
import { openNote, startNote } from './actions';
import { api } from './api';
import { findNotes, useNotes } from './store';

export const useQuickOpen = create<{ open: boolean; toggle: () => void; close: () => void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

type Found = { note: NoteMeta; snippet?: string; meaning: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The typed words in bold, as Bear shows them. */
function Marked({ text, q }: { text: string; q: string }) {
  const words = q.split(/\s+/).filter(Boolean).map(escape);
  if (!words.length) return <>{text}</>;
  return <>{text.split(new RegExp(`(${words.join('|')})`, 'gi')).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</>;
}

/**
 * ⌘O (Ctrl+O): a Spotlight-style finder, as in Bear. The first row always makes a note titled
 * with what is typed; below it, notes matching the words or the meaning. Return opens a note
 * titled exactly as typed, else makes the new one.
 */
export function QuickOpen() {
  const open = useQuickOpen((s) => s.open);
  return open ? <Finder /> : null;
}

function Finder() {
  const close = useQuickOpen((s) => s.close);
  const revision = useNotes((s) => s.revision);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ q: string; notes: Found[] }>({ q: '', notes: [] });
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const title = q.trim();

  // Recent notes before anything is typed; then matches, a moment after typing stops.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const notes: Found[] = title
        ? await findNotes(title, 'notes', 20).then((f) => f.notes.map((note) => {
            const meaning = f.meaning.has(note.path);
            return { note, meaning, snippet: meaning ? f.snippets.get(note.path) : undefined };
          }))
        : (await api.list('notes', '', 8)).map((note) => ({ note, meaning: false }));
      if (live) setFound({ q: title, notes });
    }, title ? 120 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [title, revision]);

  useEffect(() => {
    const exact = found.q ? found.notes.findIndex((f) => f.note.title.toLowerCase() === found.q.toLowerCase()) : -1;
    setActive(exact + 1);
  }, [found]);

  useEffect(() => { list.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const count = found.notes.length + 1;
  const pick = (i: number) => {
    close();
    if (i === 0) void startNote(title);
    else void openNote(found.notes[i - 1].note.path);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="finder-scrim" onMouseDown={close}>
      <div className="finder" role="dialog" aria-label="Find or create a note" onMouseDown={(e) => e.stopPropagation()}>
        <label className="finder-field">
          <Icon name="search" size={20} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Find or create a note" spellCheck={false} aria-label="Find or create a note" />
        </label>
        <div className="finder-list" ref={list} role="listbox">
          <button className={`finder-row${active === 0 ? ' on' : ''}`} role="option" aria-selected={active === 0}
            onMouseMove={() => setActive(0)} onClick={() => pick(0)}>
            <span className="finder-plus"><Icon name="plus" size={15} /></span>
            <span className="finder-title">{title ? <>Create <em>“{title}”</em></> : 'New note'}</span>
            <span className="finder-key">↩</span>
          </button>
          {found.notes.map((f, i) => (
            <button key={f.note.path} className={`finder-row${active === i + 1 ? ' on' : ''}`} role="option" aria-selected={active === i + 1}
              onMouseMove={() => setActive(i + 1)} onClick={() => pick(i + 1)}>
              <Icon name={f.meaning ? 'sparkle' : 'notes'} size={18} className={f.meaning ? 'finder-meaning' : 'finder-doc'} />
              <span className="finder-text">
                <span className="finder-title"><Marked text={f.note.title || 'Untitled'} q={found.q} /></span>
                {f.snippet ? <span className="finder-snippet">{f.snippet}</span> : null}
              </span>
              {found.q ? null : <span className="finder-time">{formatNoteDate(f.note.mtime)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

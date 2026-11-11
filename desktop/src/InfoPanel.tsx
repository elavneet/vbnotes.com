import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { headingsOf, linksTo, longDate, statsOf } from '@/utils/noteStats';
import { api } from './api';
import { Icon, type IconName } from './Icon';
import { goToHeading, openEditor } from './NoteEditor';
import { useNote, useNotes } from './store';

/** Whether the ⓘ panel is open: its button, the ⋮ menu's Toggle Statistics and ⇧⌘I. */
export const useInfo = create<{ open: boolean; toggle: () => void; close: () => void }>((set, get) => ({
  open: false,
  toggle: () => set({ open: !get().open }),
  close: () => set({ open: false }),
}));

type Tab = 'stats' | 'outline' | 'links';
const TABS: [Tab, IconName, string][] = [['stats', 'stats', 'Statistics'], ['outline', 'outline', 'Table of Contents'], ['links', 'backlinks', 'Backlinks']];

/** The open note's markdown, kept up to date while the panel shows. */
function useMarkdown(open: boolean) {
  const [md, setMd] = useState('');
  useEffect(() => {
    const editor = openEditor.editor;
    if (!open || !editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => setMd(editor.getMarkdown());
    const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(read, 250); };
    read();
    editor.on('update', later);
    return () => { editor.off('update', later); if (timer) clearTimeout(timer); };
  }, [open]);
  return md;
}

/** Notes with a `[[link]]` to this one, by its title or its file name. */
function useBacklinks(path: string, title: string, on: boolean) {
  const [notes, setNotes] = useState<{ path: string; title: string }[] | null>(null);
  useEffect(() => {
    if (!on || !title) return;
    let live = true;
    setNotes(null);
    void (async () => {
      const hits = (await api.search(title, 'notes', 200)).filter((h) => h.note.path !== path);
      const texts = await api.readFiles(hits.map((h) => h.note.path));
      if (live) setNotes(hits.filter((_, i) => linksTo(texts[i] ?? '', title, path)).map((h) => ({ path: h.note.path, title: h.note.title })));
    })().catch(() => { if (live) setNotes([]); });
    return () => { live = false; };
  }, [path, title, on]);
  return notes;
}

/** The ⓘ button: a popover under it with the note's statistics, its headings and its backlinks. */
export function InfoButton({ path }: { path: string }) {
  const { open, toggle, close } = useInfo();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ right: number; top: number; arrow: number } | null>(null);
  const [tab, setTab] = useState<Tab>('stats');
  const [created, setCreated] = useState<number | null>(null);
  const note = useNote(path);
  const md = useMarkdown(open);
  const stats = useMemo(() => statsOf(md), [md]);
  const heads = useMemo(() => headingsOf(md), [md]);
  const backlinks = useBacklinks(path, note?.title ?? '', open && tab === 'links');

  useEffect(() => { close(); }, [path, close]);
  useEffect(() => {
    if (!open) return;
    const r = button.current!.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right - 60);
    setAt({ right, top: r.bottom + 10, arrow: window.innerWidth - right - (r.left + r.width / 2) });
    void api.created(path).then(setCreated, () => setCreated(null));
    const away = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== 'Escape') return; close(); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', away);
    window.addEventListener('blur', away);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', away); window.removeEventListener('blur', away); };
  }, [open, path, close]);

  const tiles: [string, string, React.ReactNode][] = [
    [stats.words.toLocaleString(), 'Words', <Icon key="w" name="words" size={20} />],
    [stats.characters.toLocaleString(), 'Characters', <span key="c" className="info-glyph">Aa</span>],
    [stats.paragraphs.toLocaleString(), 'Paragraphs', <span key="p" className="info-glyph">¶</span>],
    [stats.read.replace(' min', 'm'), 'Read Time', <Icon key="r" name="clock" size={20} />],
  ];
  const go = (fn: () => void) => () => { close(); fn(); };

  return (
    <>
      <button ref={button} className={`icon-btn${open ? ' on' : ''}`} onClick={toggle} onMouseDown={(e) => e.stopPropagation()}
        title={`Statistics (${/Mac/.test(navigator.platform) ? '⇧⌘I' : 'Ctrl+Shift+I'})`} aria-label="Statistics" aria-expanded={open}>
        <Icon name="info" />
      </button>
      {open && at ? (
        <div className="info-pop" style={{ right: at.right, top: at.top }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Statistics">
          <span className="info-arrow" style={{ right: at.arrow - 9 }} />
          <h3>{TABS.find((t) => t[0] === tab)![2]}</h3>
          <div className="segmented info-tabs">
            {TABS.map(([id, icon, label]) => (
              <button key={id} className={tab === id ? 'on' : undefined} onClick={() => setTab(id)} title={label} aria-label={label}><Icon name={icon} size={18} /></button>
            ))}
          </div>
          {tab === 'stats' ? (
            <>
              <div className="info-tiles">
                {tiles.map(([n, label, icon]) => (
                  <div key={label} className="info-tile"><b>{n}</b>{icon}<span>{label}</span></div>
                ))}
              </div>
              <div className="info-dates">
                {note ? <div><b>{longDate(note.mtime)}</b><span>Modified</span><Icon name="calendar" size={20} /></div> : null}
                {created ? <div><b>{longDate(created)}</b><span>Created</span><Icon name="calendar" size={20} /></div> : null}
              </div>
            </>
          ) : tab === 'outline' ? (
            <div className="info-list">
              {heads.length ? heads.map((h, i) => (
                <button key={i} style={{ paddingLeft: 10 + (h.level - 1) * 14 }} className={h.level === 1 ? 'top' : undefined} onClick={go(() => goToHeading(i))}>{h.text}</button>
              )) : <p className="info-empty">No headings in this note.</p>}
            </div>
          ) : (
            <div className="info-list">
              {backlinks === null ? <p className="info-empty">Looking…</p>
                : backlinks.length ? backlinks.map((b) => (
                  <button key={b.path} onClick={go(() => void openEditor.flush().then(() => useNotes.getState().select(b.path)))}>{b.title}</button>
                )) : <p className="info-empty">No notes link here yet.</p>}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

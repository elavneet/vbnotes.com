import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { formatNoteDate } from '@/utils/dates';
import { startNote } from './actions';
import { api } from './api';
import { addFiles } from './fileDrop';
import { setupHost } from './host';
import { Icon, type IconName } from './Icon';
import { NoteEditor, openEditor } from './NoteEditor';
import { startMeaning } from './meaning';
import { NoteList } from './NoteList';
import { QuickOpen, useQuickOpen } from './QuickOpen';
import { Settings, useSettingsOpen } from './Settings';
import { Sidebar, useDrawer } from './Sidebar';
import { useStyleBar } from './StyleBar';
import { savedFolder, useNote, useNotes } from './store';
import { useApplyTheme, useTheme } from './theme';
import { useWindowClose } from './windowClose';
import { welcomeOnce } from './welcome';

export function App() {
  const theme = useTheme();
  useApplyTheme(theme);
  const folder = useNotes((s) => s.folder);
  const error = useNotes((s) => s.error);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void (async () => {
      const last = (await api.launchFolder().catch(() => null)) ?? savedFolder();
      if (last) await useNotes.getState().openFolder(last);
      setBooted(true);
    })();
  }, []);
  useEffect(() => { if (folder) setupHost(folder); }, [folder]);

  // Notes opened with VB Notes from Finder or Explorer wait for a notes folder, then come in.
  useEffect(() => {
    if (!folder) return;
    const take = () => void api.openedFiles().then((paths) => (paths.length ? addFiles(paths) : undefined)).catch((e) => console.warn('opening files failed', e));
    take();
    const off = listen('files-opened', take);
    return () => { void off.then((f) => f()); };
  }, [folder]);
  useEffect(() => { void startMeaning(); }, []);

  // The close button saves the open note first; it hides the window instead with the tray on.
  useWindowClose();

  if (!booted) return <div className="app" />;
  if (!folder) return <Welcome error={error} />;
  return <Main />;
}

function Main() {
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = useNotes((s) => s.selected);
  const drawer = useDrawer();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'n') { e.preventDefault(); void startNote(); }
      else if (k === 'o') { e.preventDefault(); useQuickOpen.getState().toggle(); }
      else if (k === 'f' && !e.shiftKey) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (k === 's') { e.preventDefault(); void openEditor.flush(); }
      else if (k === ',') { e.preventDefault(); useSettingsOpen.getState().set(true); }
      else if (k === 'y' && e.shiftKey) { e.preventDefault(); useStyleBar.getState().toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app${selected ? ' reading' : ''}${drawer.open ? ' drawer' : ''}`}>
      <Sidebar />
      {drawer.open ? <div className="drawer-scrim" onMouseDown={() => drawer.set(false)} /> : null}
      <NoteList searchRef={searchRef} onCreate={() => void startNote()} />
      <main className="editor-pane">
        {selected ? <EditorBar path={selected} /> : <div className="editor-bar" data-tauri-drag-region />}
        {selected ? <NoteEditor path={selected} /> : (
          <div className="editor-empty">
            <Icon name="notes" size={34} />
            <p>Pick a note, start one with ⌘N, or find one with ⌘O.</p>
          </div>
        )}
      </main>
      <Settings />
      <QuickOpen />
    </div>
  );
}

const edited = (ms: number) => {
  const when = formatNoteDate(ms);
  return when.endsWith('min') ? `${when} ago` : when === 'Just now' || when === 'Yesterday' ? when.toLowerCase() : when;
};

/** Above the open note: when it was edited, and the phone's note actions. */
function EditorBar({ path }: { path: string }) {
  const note = useNote(path);
  const { section, togglePin, archive, trash, restore, deleteForever } = useNotes.getState();
  const act = (fn: (p: string) => Promise<unknown>) => async () => { await openEditor.flush(); await fn(path); };
  const styles = useStyleBar();
  return (
    <div className="editor-bar" data-tauri-drag-region>
      <button className="icon-btn single-only" onClick={act(async () => useNotes.getState().select(null))} title="Back to the notes" aria-label="Back to the notes"><Icon name="back" /></button>
      <span className="edited" data-tauri-drag-region>{note ? `Edited ${edited(note.mtime)}` : ''}</span>
      {section === 'trash' ? null : (
        <button className={`icon-btn biu${styles.shown ? ' on' : ''}`} onClick={styles.toggle} title={`${styles.shown ? 'Hide' : 'Show'} the style bar (${/Mac/.test(navigator.platform) ? '⇧⌘Y' : 'Ctrl+Shift+Y'})`} aria-pressed={styles.shown}>
          <b>B</b><i>I</i><u>U</u>
        </button>
      )}
      {section === 'trash' ? (
        <>
          <button className="icon-btn" onClick={act(restore)} title="Restore"><Icon name="restore" /></button>
          <button className="icon-btn danger" onClick={act(deleteForever)} title="Delete forever"><Icon name="trash" /></button>
        </>
      ) : (
        <>
          <button className={`icon-btn${note?.pinned ? ' on' : ''}`} onClick={act(togglePin)} title={note?.pinned ? 'Unpin' : 'Pin to top'}><Icon name="pin" /></button>
          {section === 'archive'
            ? <button className="icon-btn" onClick={act(restore)} title="Move to Notes"><Icon name="restore" /></button>
            : <button className="icon-btn" onClick={act(archive)} title="Archive"><Icon name="archive" /></button>}
          <button className="icon-btn" onClick={act(trash)} title="Move to Trash"><Icon name="trash" /></button>
        </>
      )}
    </div>
  );
}

/** "iCloud Drive › VB Notes" for a folder in iCloud Drive, else its last two parts. */
function placeName(path: string) {
  if (path.includes('/iCloud~com~lavneet~vbnotes/')) return 'iCloud Drive › VB Notes';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return path.includes('/com~apple~CloudDocs/') ? `iCloud Drive › ${parts[parts.length - 1]}` : parts.slice(-2).join(' › ');
}

/**
 * First launch: where the notes live, as on the iPhone. iCloud Drive comes first on a Mac: the
 * iPhone app's own folder there once a phone has made it, so both show the same notes.
 */
function Welcome({ error }: { error?: string }) {
  const [places, setPlaces] = useState<{ icloud: string | null; here: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const openFolder = useNotes((s) => s.openFolder);
  const start = async (path: string) => {
    await openFolder(path);
    await welcomeOnce().catch((e) => console.warn('welcome note not written', e));
  };
  useEffect(() => { void api.folderPlaces().then(setPlaces, (e) => setProblem(String(e))); }, []);
  const choose = async () => {
    const picked = await open({ directory: true, title: 'Choose your notes folder' });
    if (typeof picked === 'string') await start(picked);
  };
  const use = (place: 'icloud' | 'here') => async () => {
    try { await start(await api.makePlace(place)); } catch (e) { setProblem(String(e)); }
  };
  const option = (onClick: () => void, icon: IconName, title: string, text: string, first = false) => (
    <button className={`place${first ? ' first' : ''}`} onClick={onClick}>
      <span className="place-icon"><Icon name={icon} size={20} /></span>
      <span className="place-text">
        <span className="place-title">{title}{first ? <span className="place-tag">Recommended</span> : null}</span>
        <span className="place-sub">{text}</span>
      </span>
      <Icon name="chevron" size={16} className="place-go" />
    </button>
  );
  return (
    <div className="welcome" data-tauri-drag-region>
      <div className="welcome-card">
        <h1>Where should your notes live?</h1>
        <p>Every note is a plain .md file in a folder. You can change this later in Settings.</p>
        {error || problem ? <p className="error">{error ?? problem}</p> : null}
        {places?.icloud ? option(() => void use('icloud')(), 'cloud', 'iCloud Drive', `${placeName(places.icloud)}. Notes stay in step with VB Notes on your iPhone.`, true) : null}
        {option(() => void choose(), 'folder', 'Choose a folder…', 'One you already have: iCloud Drive, Dropbox, Syncthing or any other.')}
        {places ? option(() => void use('here')(), 'computer', 'On this computer', `${placeName(places.here)}, on this computer only.`) : null}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { formatNoteDate } from '@/utils/dates';
import { startNote } from './actions';
import { api } from './api';
import { setupHost } from './host';
import { Icon } from './Icon';
import { NoteEditor, openEditor } from './NoteEditor';
import { startMeaning } from './meaning';
import { NoteList } from './NoteList';
import { QuickOpen, useQuickOpen } from './QuickOpen';
import { Settings, useSettingsOpen } from './Settings';
import { Sidebar } from './Sidebar';
import { savedFolder, useNote, useNotes } from './store';
import { useApplyTheme, useTheme } from './theme';

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
  useEffect(() => { void startMeaning(); }, []);

  // Closing the window saves the open note first.
  useEffect(() => {
    const off = getCurrentWindow().onCloseRequested(async () => { await openEditor.flush(); });
    return () => { void off.then((f) => f()); };
  }, []);

  if (!booted) return <div className="app" />;
  if (!folder) return <Welcome error={error} />;
  return <Main />;
}

function Main() {
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = useNotes((s) => s.selected);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'n') { e.preventDefault(); void startNote(); }
      else if (k === 'o') { e.preventDefault(); useQuickOpen.getState().toggle(); }
      else if (k === 'f' && !e.shiftKey) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (k === 's') { e.preventDefault(); void openEditor.flush(); }
      else if (k === ',') { e.preventDefault(); useSettingsOpen.getState().set(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Sidebar />
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
  return (
    <div className="editor-bar" data-tauri-drag-region>
      <span className="edited" data-tauri-drag-region>{note ? `Edited ${edited(note.mtime)}` : ''}</span>
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

/** First launch: where the notes live. The same folder as the phone's (iCloud Drive › VBNotes) keeps both in step. */
function Welcome({ error }: { error?: string }) {
  const [suggested, setSuggested] = useState('');
  const openFolder = useNotes((s) => s.openFolder);
  useEffect(() => { void api.suggestedFolder(false).then(setSuggested); }, []);
  const choose = async () => {
    const picked = await open({ directory: true, title: 'Choose your notes folder' });
    if (typeof picked === 'string') await openFolder(picked);
  };
  const useSuggested = async () => openFolder(await api.suggestedFolder(true));
  return (
    <div className="welcome" data-tauri-drag-region>
      <div className="welcome-card">
        <h1>VB Notes</h1>
        <p>Your notes are plain markdown files in a folder. Pick the same folder as on your phone (iCloud Drive › VBNotes) and both stay in step.</p>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" onClick={() => void useSuggested()}>Use {suggested.split(/[\\/]/).slice(-2).join(' › ') || 'VBNotes'}</button>
        <button className="secondary" onClick={() => void choose()}>Choose another folder…</button>
      </div>
    </div>
  );
}

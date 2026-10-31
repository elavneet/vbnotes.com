import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import type { ThemeName } from '@/theme/tokens';
import { CODE_FONTS, TEXT_FONTS, codeFont, textFont, type Typography } from '@/theme/typography';
import { api } from './api';
import { useMeaning } from './meaning';
import { useNotes } from './store';
import { themesOf, useThemePrefs, type ThemePref } from './theme';

export const useSettingsOpen = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

/** Settings (⌘,): the phone's Appearance, Typography, Search, Hide from Notes, Notes folder and About, in a sheet over the window. */
export function Settings() {
  const { open: visible, set: setOpen } = useSettingsOpen();
  const prefs = useThemePrefs();
  const folder = useNotes((s) => s.folder);
  const openFolder = useNotes((s) => s.openFolder);
  const noteCount = useNotes((s) => s.counts.notes + s.counts.archive + s.counts.trash);
  // A folder just picked, waiting for: copy the notes there, or open it as it is.
  const [picked, setPicked] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  useEffect(() => { void getVersion().then(setVersion).catch(() => {}); }, []);
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, setOpen]);
  if (!visible) return null;

  const ty = prefs.typography;
  const setTy = (patch: Partial<Typography>) => prefs.set({ typography: { ...ty, ...patch } });
  const changeFolder = async () => {
    const path = await open({ directory: true, title: 'Choose your notes folder' });
    if (typeof path !== 'string' || path === folder) return;
    setCopyError(null);
    if (noteCount) setPicked(path); else { await openFolder(path); setOpen(false); }
  };
  const switchTo = async (copy: boolean) => {
    if (!picked) return;
    try {
      if (copy) await api.copyFolder(picked);
    } catch (e) {
      setCopyError(String(e));
      return;
    }
    await openFolder(picked);
    setPicked(null);
    setOpen(false);
  };

  return (
    <div className="sheet-scrim" onMouseDown={() => setOpen(false)}>
      <div className="sheet" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Settings</h2>
          <button className="text-btn" onClick={() => setOpen(false)}>Done</button>
        </header>
        <div className="sheet-body">
          <h3>Appearance</h3>
          <div className="segmented">
            {(['system', 'light', 'dark'] as ThemePref[]).map((p) => (
              <button key={p} className={prefs.pref === p ? 'on' : undefined} onClick={() => prefs.set({ pref: p })}>{p[0].toUpperCase() + p.slice(1)}</button>
            ))}
          </div>
          <p className="hint">System follows the computer: the light theme by day, the dark one at night.</p>
          <ThemeRow name="light" />
          <ThemeRow name="dark" />

          <h3>Typography</h3>
          <Pick label="Text" value={ty.text} options={TEXT_FONTS} onChange={(text) => setTy({ text })} css={textFont(ty.text).css} />
          <Pick label="Headings" value={ty.head} options={TEXT_FONTS} onChange={(head) => setTy({ head })} css={textFont(ty.head).css} />
          <Pick label="Code" value={ty.code} options={CODE_FONTS} onChange={(code) => setTy({ code })} css={codeFont(ty.code).css} />
          <Step label="Text size" value={ty.size} min={13} max={24} step={1} show={(v) => `${v} pt`} onChange={(size) => setTy({ size })} />
          <Step label="Line height" value={ty.line} min={1.3} max={2} step={0.05} show={(v) => v.toFixed(2)} onChange={(line) => setTy({ line })} />
          <Step label="Paragraph spacing" value={ty.para} min={0} max={1.5} step={0.25} show={(v) => v.toFixed(2)} onChange={(para) => setTy({ para })} />

          <h3>Search</h3>
          <MeaningSetting />

          <h3>Hide from Notes</h3>
          <HiddenTags />

          <h3>Notes folder</h3>
          <div className="row-setting">
            <span className="path" title={folder ?? ''}><bdi>{folder}</bdi></span>
            <button className="text-btn" onClick={() => void changeFolder()}>Change…</button>
          </div>
          {picked ? (
            <div className="folder-choice">
              <p>Copy your {noteCount.toLocaleString()} notes to <b>{picked.split(/[\\/]/).pop()}</b>, or open it as it is? The notes here stay where they are.</p>
              {copyError ? <p className="error">{copyError}</p> : null}
              <div className="folder-choice-buttons">
                <button className="secondary" onClick={() => setPicked(null)}>Cancel</button>
                <button className="secondary" onClick={() => void switchTo(false)}>Open as it is</button>
                <button className="primary" onClick={() => void switchTo(true)}>Copy {noteCount.toLocaleString()} notes</button>
              </div>
            </div>
          ) : null}
          <p className="hint">Notes are plain .md files. Use the folder your phone uses (iCloud Drive › VBNotes) to see the same notes on both.</p>

          <h3>About</h3>
          <div className="row-setting"><span>Version</span><span className="value">{version}</span></div>
        </div>
      </div>
    </div>
  );
}

/** Search by meaning: on or off, and how far the model has got. */
function MeaningSetting() {
  const { on, setOn, status } = useMeaning();
  const n = (count: number, one: string) => `${count.toLocaleString()} ${one}${count === 1 ? '' : 's'}`;
  const line = !on
    ? 'Search finds the words you type. Switched on, it also finds notes by what they mean, with the phone\'s search model (380 MB, downloaded once).'
    : status.state === 'downloading' ? `Downloading the search model… ${Math.round(status.progress * 100)}%`
    : status.state === 'loading' ? 'Getting the search model ready…'
    : status.state === 'error' ? `${status.error ?? 'The search model failed.'} It tries again when a note changes, or switch it off and on.`
    : status.state === 'ready' && status.pending > 0 ? `Reading your notes… ${n(status.indexed, 'note')} ready, ${n(status.pending, 'part')} to go.`
    : status.state === 'ready' ? `Ready: ${n(status.indexed, 'note')}. The model runs on this computer; notes never leave it.`
    : 'Starting…';
  return (
    <>
      <label className="row-setting">
        <span>Search by meaning</span>
        <input type="checkbox" className="switch" checked={on} onChange={(e) => setOn(e.target.checked)} />
      </label>
      <p className="hint">{line}</p>
    </>
  );
}

/** Tags kept out of the Notes list (shared with the phone through the folder's `.vbnotes/meta.json`). */
function HiddenTags() {
  const hidden = useNotes((s) => s.hiddenTags);
  const setHiddenTags = useNotes((s) => s.setHiddenTags);
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    void setHiddenTags([...hidden, draft]);
    setDraft('');
  };
  return (
    <>
      {hidden.length ? (
        <div className="hidden-tags">
          {hidden.map((h) => (
            <span key={h} className="hidden-tag">
              #{h}
              <button onClick={() => void setHiddenTags(hidden.filter((x) => x !== h))} aria-label={`Show #${h} in Notes again`} title="Show in Notes again">×</button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="row-setting">
        <input className="text-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Add a tag, like melta" spellCheck={false} aria-label="Tag to hide from Notes" />
        <button className="text-btn" onClick={add} disabled={!draft.trim()}>Hide</button>
      </div>
      <p className="hint">Notes with these tags stay out of Notes, at any level: melta hides #melta and #go2lister/melta. Pick the tag in the sidebar to see them. The phone uses the same list.</p>
    </>
  );
}

function ThemeRow({ name }: { name: ThemeName }) {
  const prefs = useThemePrefs();
  const chosen = name === 'light' ? prefs.light : prefs.dark;
  const pick = (id: string) => {
    // A fixed mode of the other kind would hide the choice.
    const pref = prefs.pref !== 'system' && prefs.pref !== name ? name : prefs.pref;
    prefs.set(name === 'light' ? { light: id, pref } : { dark: id, pref });
  };
  return (
    <div className="themes">
      <span className="label">{name === 'light' ? 'Light theme' : 'Dark theme'}</span>
      <div className="swatches">
        {themesOf(name).map((th) => (
          <button key={th.id} className={`swatch${th.id === chosen ? ' on' : ''}`} onClick={() => pick(th.id)} title={th.label}>
            <span className="swatch-face" style={{ background: th.colors.bg, color: th.colors.text, borderColor: th.colors.border }}>
              Aa
              <span className="dots">
                <i style={{ background: th.colors.accent }} />
                <i style={{ background: th.colors.volt }} />
              </span>
            </span>
            <span className="swatch-name">{th.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Pick<K extends string>({ label, value, options, onChange, css }: {
  label: string; value: string; options: Record<K, { label: string }>; onChange: (id: K) => void; css: string;
}) {
  return (
    <label className="row-setting">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as K)} style={{ fontFamily: css }}>
        {(Object.keys(options) as K[]).map((id) => <option key={id} value={id}>{options[id].label}</option>)}
      </select>
    </label>
  );
}

function Step({ label, value, min, max, step, show, onChange }: {
  label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void;
}) {
  const go = (d: number) => onChange(Math.min(max, Math.max(min, Math.round((value + d) * 100) / 100)));
  return (
    <div className="row-setting">
      <span>{label}</span>
      <span className="stepper">
        <button onClick={() => go(-step)} disabled={value <= min} aria-label={`Less ${label.toLowerCase()}`}>−</button>
        <span className="value">{show(value)}</span>
        <button onClick={() => go(step)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>+</button>
      </span>
    </div>
  );
}

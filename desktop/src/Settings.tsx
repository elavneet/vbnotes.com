import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import type { ThemeName } from '@/theme/tokens';
import { CODE_FONTS, DIAGRAM_SIZES, TEXT_FONTS, codeFont, textFont, type DiagramSize, type Typography } from '@/theme/typography';
import { api } from './api';
import { useMeaning } from './meaning';
import { useNotes } from './store';
import { themesOf, useThemePrefs, type ThemePref } from './theme';
import { TRAY_OFFERED, useTray } from './windowClose';
import { useCountUse } from './usage';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PROVIDERS, chatModels, preferredModel, providerOf, useAi, useSpend } from './ai';
import { formatCost, keyUsageFrom, showsSpend, spentThisMonth, type KeyUsage } from '@/ai/spend';
import { CONSENT_TEXT, CONSENT_TITLE } from '@/ai/prompt';

export const useSettingsOpen = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

type Page = 'main' | 'appearance' | 'typography' | 'folder' | 'hidden' | 'search' | 'ai' | 'window';
const TITLES: Record<Page, string> = {
  main: 'Settings', appearance: 'Appearance', typography: 'Typography', folder: 'Notes folder', hidden: 'Hide from Notes', search: 'Local search', ai: 'AI chat', window: 'Window',
};

/**
 * Settings (⌘,), laid out as on the phone: a short list of groups, each opening its own page in
 * the same sheet. Escape goes back to the list, then closes.
 */
export function Settings() {
  const { open: visible, set: setOpen } = useSettingsOpen();
  const [page, setPage] = useState<Page>('main');
  const prefs = useThemePrefs();
  const folder = useNotes((s) => s.folder);
  const openFolder = useNotes((s) => s.openFolder);
  const noteCount = useNotes((s) => s.counts.notes + s.counts.archive + s.counts.trash);
  const hidden = useNotes((s) => s.hiddenTags);
  const meaning = useMeaning();
  const ai = useAi((s) => s.view);
  const loadAi = useAi((s) => s.load);
  const tray = useTray((s) => s.on);
  const counting = useCountUse();
  // A folder just picked, waiting for: copy the notes there, or open it as it is.
  const [picked, setPicked] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  useEffect(() => { void getVersion().then(setVersion).catch(() => {}); }, []);
  useEffect(() => { if (visible) setPage('main'); else setPicked(null); }, [visible]);
  useEffect(() => { if (visible && !ai) void loadAi(); }, [visible, ai, loadAi]);
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (page === 'main') setOpen(false); else setPage('main');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, setOpen, page]);
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

  const modeLabel = prefs.pref === 'system' ? 'System' : prefs.pref === 'dark' ? 'Dark' : 'Light';
  const st = meaning.status;
  const searchLabel = !meaning.on ? 'Exact words'
    : st.state === 'downloading' ? `Downloading ${Math.round(st.progress * 100)}%`
    : st.state === 'error' ? 'Not working'
    : st.state === 'ready' && st.pending > 0 ? 'Reading notes…'
    : st.state === 'ready' ? 'By meaning'
    : 'Starting…';

  return (
    <div className="sheet-scrim" onMouseDown={() => setOpen(false)}>
      <div className="sheet" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          {page !== 'main' ? (
            <button className="text-btn back-btn" onClick={() => setPage('main')} aria-label="Back to Settings">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
              Settings
            </button>
          ) : <span />}
          <h2>{TITLES[page]}</h2>
          <button className="text-btn done-btn" onClick={() => setOpen(false)}>Done</button>
        </header>
        <div className="sheet-body" key={page}>
          {page === 'main' ? (
            <>
              <Group>
                <NavRow label="Appearance" value={modeLabel} onClick={() => setPage('appearance')} />
                <NavRow label="Typography" value={`${textFont(ty.text).label}, ${ty.size} pt`} onClick={() => setPage('typography')} />
              </Group>
              <Group>
                <NavRow label="Notes folder" value={folder ? folderLabel(folder) : '…'} onClick={() => setPage('folder')} />
                <NavRow label="Hide from Notes" value={hidden.length ? hidden.map((h) => `#${h}`).join(', ') : 'None'} onClick={() => setPage('hidden')} />
              </Group>
              <Group>
                <NavRow label="Local search" value={searchLabel} onClick={() => setPage('search')} />
                <NavRow label="AI chat" value={ai?.enabled ? providerOf(ai.provider).name : 'Off'} onClick={() => setPage('ai')} />
              </Group>
              {TRAY_OFFERED ? (
                <Group>
                  <NavRow label="Window" value={tray ? 'Keeps running in the tray' : 'Closing quits'} onClick={() => setPage('window')} />
                </Group>
              ) : null}
              <Group title="About" footer="Once a day VB Notes tells our server it was used, with only the kind of computer and the app version: no id, nothing about you or your notes.">
                <div className="row-setting"><span>Version</span><span className="value">{version}</span></div>
                <label className="row-setting">
                  <span>Count me as a user</span>
                  <input type="checkbox" className="switch" checked={counting.on} onChange={(e) => counting.set(e.target.checked)} />
                </label>
              </Group>
            </>
          ) : null}

          {page === 'appearance' ? (
            <Group title="Mode" footer="System follows the computer: the light theme by day, the dark one at night.">
              <div className="row-setting row-wide">
                <div className="segmented">
                  {(['system', 'light', 'dark'] as ThemePref[]).map((p) => (
                    <button key={p} className={prefs.pref === p ? 'on' : undefined} onClick={() => prefs.set({ pref: p })}>{p[0].toUpperCase() + p.slice(1)}</button>
                  ))}
                </div>
              </div>
              <ThemeRow name="light" />
              <ThemeRow name="dark" />
            </Group>
          ) : null}

          {page === 'typography' ? (
            <>
              <Group title="Fonts and spacing">
                <Pick label="Text" value={ty.text} options={TEXT_FONTS} onChange={(text) => setTy({ text })} css={textFont(ty.text).css} />
                <Pick label="Headings" value={ty.head} options={TEXT_FONTS} onChange={(head) => setTy({ head })} css={textFont(ty.head).css} />
                <Pick label="Code" value={ty.code} options={CODE_FONTS} onChange={(code) => setTy({ code })} css={codeFont(ty.code).css} />
                <Step label="Text size" value={ty.size} min={13} max={24} step={1} show={(v) => `${v} pt`} onChange={(size) => setTy({ size })} />
                <Step label="Line height" value={ty.line} min={1.3} max={2} step={0.05} show={(v) => v.toFixed(2)} onChange={(line) => setTy({ line })} />
                <Step label="Paragraph spacing" value={ty.para} min={0} max={1.5} step={0.25} show={(v) => v.toFixed(2)} onChange={(para) => setTy({ para })} />
              </Group>
              <Group footer="A number beside each line of a note, as in a code editor.">
                <label className="row-setting">
                  <span>Line numbers</span>
                  <input type="checkbox" className="switch" checked={ty.lines} onChange={(e) => setTy({ lines: e.target.checked })} />
                </label>
              </Group>
              <Group title="Diagrams" footer="How big Mermaid diagrams are drawn, never wider than the note. Double-click one to zoom.">
                <div className="row-setting row-wide">
                  <div className="segmented">
                    {(Object.keys(DIAGRAM_SIZES) as DiagramSize[]).map((d) => (
                      <button key={d} className={ty.diagrams === d ? 'on' : undefined} onClick={() => setTy({ diagrams: d })}>{DIAGRAM_SIZES[d].label}</button>
                    ))}
                  </div>
                </div>
              </Group>
            </>
          ) : null}

          {page === 'folder' ? (
            <Group title="Location" footer="Notes are plain .md files. Use the folder your phone uses (iCloud Drive › VBNotes) to see the same notes on both.">
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
            </Group>
          ) : null}

          {page === 'hidden' ? <HiddenTags /> : null}
          {page === 'search' ? <MeaningSetting /> : null}
          {page === 'ai' ? <AiSetting /> : null}
          {page === 'window' ? <TraySetting /> : null}
        </div>
      </div>
    </div>
  );
}

/** The notes folder in a few words: the app's own iCloud folder ends in "Documents", which says nothing. */
function folderLabel(folder: string) {
  const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
  if (folder.includes('/iCloud~com~lavneet~vbnotes/')) return 'iCloud Drive · VB Notes';
  if (folder.includes('/Mobile Documents/')) return `iCloud Drive · ${name}`;
  return name;
}

/** An inset group of rows, with an optional title over it and a note under it, as on the phone. */
function Group({ title, footer, children }: { title?: string; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="set-group">
      {title ? <h3>{title}</h3> : null}
      <div className="set-card">{children}</div>
      {footer ? <p className="hint">{footer}</p> : null}
    </section>
  );
}

/** A row that opens a page: the current value and a chevron. */
function NavRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button className="row-setting nav-row" onClick={onClick}>
      <span>{label}</span>
      <span className="value">{value}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
    </button>
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
    <Group footer={line}>
      <label className="row-setting">
        <span>Search by meaning</span>
        <input type="checkbox" className="switch" checked={on} onChange={(e) => setOn(e.target.checked)} />
      </label>
    </Group>
  );
}

/**
 * Chat with AI (off until switched on): the provider, its API key (kept by the Rust side on this
 * computer, never in the notes folder) and the model, picked from the provider's own list.
 */
function AiSetting() {
  const { view, load, save } = useAi();
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Turning it on first asks for permission to send notes to a provider.
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!view) void load(); }, [view, load]);
  const fetchModels = async (pick: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const ids = chatModels(await api.aiModels());
      setModels(ids);
      const now = useAi.getState().view;
      if (now && (pick || !now.model) && ids.length) await save({ model: now.model && ids.includes(now.model) ? now.model : preferredModel(now.provider, ids) });
    } catch (e) {
      setModels(null);
      setProblem(String(e));
    } finally {
      setBusy(false);
    }
  };
  // The model list once the provider can be asked: a key saved, or none needed.
  const canList = !!view?.enabled && (view.hasKey || !view.needsKey);
  const listKey = `${view?.provider}:${view?.hasKey}:${view?.baseUrl}`;
  useEffect(() => { if (canList) void fetchModels(false); else setModels(null); }, [canList, listKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return null;
  const p = providerOf(view.provider);
  const saveKey = async (k: string) => { setKey(''); await save({}, k); };
  return (
    <>
      <Group footer={view.enabled
        ? 'Ask about the open note or all your notes, from the sparkle button over a note or ⇧⌘J. Only what you ask about is sent, and only when you ask.'
        : 'Off: nothing is ever sent. Switched on, you can ask an AI about one note or all of them, with your own account at OpenRouter, OpenAI, Anthropic, Google and others.'}>
      <label className="row-setting">
        <span>Chat with AI</span>
        <input type="checkbox" className="switch" checked={view.enabled || asking} onChange={(e) => (e.target.checked ? setAsking(true) : void save({ enabled: false }))} />
      </label>
      {asking ? (
        <div className="folder-choice">
          <p><b>{CONSENT_TITLE}</b> {CONSENT_TEXT}</p>
          <div className="folder-choice-buttons">
            <button className="secondary" onClick={() => setAsking(false)}>Not now</button>
            <button className="primary" onClick={() => { setAsking(false); void save({ enabled: true }); }}>Turn on</button>
          </div>
        </div>
      ) : null}
      </Group>
      {view.enabled ? (
        <Group footer={problem ? <span className="error">{problem}</span> : p.keyUrl ? (
          <>Get a key at <a href={p.keyUrl} onClick={(e) => { e.preventDefault(); void openUrl(p.keyUrl!); }}>{p.keyUrl.replace(/^https:\/\//, '')}</a>. It stays on this computer, out of your notes folder.</>
        ) : undefined}>
          <div className="row-setting">
            <span>Provider</span>
            <select value={view.provider} onChange={(e) => { setModels(null); void save({ provider: e.target.value, model: '', baseUrl: providerOf(e.target.value).address ?? '' }); }}>
              {PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          {p.address !== undefined ? (
            <div className="row-setting">
              <span>Address</span>
              <input className="text-input right" defaultValue={view.baseUrl} key={view.provider} placeholder={p.address || 'https://…/v1'} spellCheck={false}
                onBlur={(e) => { if (e.target.value.trim() !== view.baseUrl) void save({ baseUrl: e.target.value.trim() }); }} />
            </div>
          ) : null}
          {view.needsKey || p.id === 'custom' ? (
            <div className="row-setting">
              <span>API key</span>
              <input className="text-input right" type="password" value={key} placeholder={view.hasKey ? 'Saved. Paste a new one to replace it' : 'Paste your key'} spellCheck={false} autoComplete="off"
                onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) void saveKey(key); }} />
              {key.trim() ? <button className="text-btn" onClick={() => void saveKey(key)}>Save</button>
                : view.hasKey ? <button className="text-btn" onClick={() => void saveKey('')}>Remove</button> : null}
            </div>
          ) : null}
          <div className="row-setting">
            <span>Model</span>
            {models?.length ? (
              <select value={view.model} onChange={(e) => void save({ model: e.target.value })}>
                {view.model && !models.includes(view.model) ? <option value={view.model}>{view.model}</option> : null}
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="text-input right" defaultValue={view.model} key={`${view.provider}-${view.model}`} placeholder={canList ? (busy ? 'Loading…' : 'Model name') : 'Add a key first'} spellCheck={false}
                onBlur={(e) => { if (e.target.value.trim() !== view.model) void save({ model: e.target.value.trim() }); }} />
            )}
            {canList ? <button className="text-btn" disabled={busy} onClick={() => void fetchModels(false)}>{busy ? 'Loading…' : 'Refresh'}</button> : null}
          </div>
        </Group>
      ) : null}
      {view.enabled && showsSpend(view.provider) && view.hasKey ? <SpendRows /> : null}
    </>
  );
}

/** What OpenRouter answers have cost: this computer this month (exact, from each reply), and the key's own totals. */
function SpendRows() {
  const spend = useSpend((s) => s.spend);
  const [usage, setUsage] = useState<KeyUsage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.aiKeyUsage().then((v) => { if (live) setUsage(keyUsageFrom(v as never)); }, (e) => { if (live) setProblem(String(e)); });
    return () => { live = false; };
  }, []);
  return (
    <Group title="Spending" footer={problem ?? "OpenRouter reports what each answer costs. The key's totals include any other apps that use the same key."}>
      <div className="row-setting"><span>Spent in VB Notes this month</span><span className="value">{formatCost(spentThisMonth(spend))}</span></div>
      <div className="row-setting"><span>Key: this month / in total</span><span className="value">{usage ? `${formatCost(usage.month)} / ${formatCost(usage.total)}` : '…'}</span></div>
      {usage && usage.left !== null ? <div className="row-setting"><span>Left on the key</span><span className="value">{formatCost(usage.left)}</span></div> : null}
    </Group>
  );
}

/** Windows: closing the window can leave the app in the system tray. */
function TraySetting() {
  const { on, set } = useTray();
  return (
    <Group footer={on ? 'Closing the window leaves VB Notes in the system tray, by the clock. Click its icon to open it again; right-click it to quit.' : 'Closing the window quits VB Notes.'}>
      <label className="row-setting">
        <span>Keep running in the tray</span>
        <input type="checkbox" className="switch" checked={on} onChange={(e) => set(e.target.checked)} />
      </label>
    </Group>
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
    <Group footer="Notes with these tags stay out of Notes, at any level: melta hides #melta and #go2lister/melta. Pick the tag in the sidebar to see them. The phone uses the same list.">
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
    </Group>
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

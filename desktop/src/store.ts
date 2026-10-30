import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { fileNameFromTitle, splitTitle } from '@/utils/markdown';
import { META_PATH, RESERVED_FOLDERS, basename, dirname, joinPath, type VaultMeta } from '@/vault/types';
import { buildTags, recordFrom, sectionOf, type NoteMeta, type NoteRecord, type Section, type SectionCounts, type TagNode } from '@/store/noteModel';
import { api, type Hit } from './api';

/** Watch events this soon after our own write are our own echo. */
const SELF_WRITE_MS = 2000;
/** Files read at a time in a folder scan; the list fills batch by batch on a first scan. */
const SCAN_BATCH = 100;
const FOLDER_KEY = 'vbnotes.folder';
const EMPTY_COUNTS: SectionCounts = { notes: 0, archive: 0, trash: 0, untagged: 0 };

interface NotesState {
  /** The notes folder (absolute path), or null before one is chosen. */
  folder: string | null;
  /** The folder has been scanned once since it was opened, so the index lists every note. */
  scanned: boolean;
  error?: string;
  tags: TagNode[];
  counts: SectionCounts;
  pinned: string[];
  /** Goes up whenever a note changes; lists read the index again. */
  revision: number;
  section: Section;
  /** A tag (`dev/code`), UNTAGGED, or '' for every note of the section. */
  tag: string;
  selected: string | null;
  /** A note just made: its editor takes the focus. */
  fresh: string | null;

  openFolder: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  readText: (path: string) => Promise<string>;
  createNote: (initial?: string) => Promise<string>;
  saveNote: (path: string, md: string) => Promise<void>;
  syncTitle: (path: string) => Promise<string>;
  moveTo: (path: string, folder: string) => Promise<string>;
  trash: (path: string) => Promise<string>;
  archive: (path: string) => Promise<string>;
  restore: (path: string) => Promise<string>;
  deleteForever: (path: string) => Promise<void>;
  togglePin: (path: string) => Promise<void>;
  show: (section: Section, tag?: string) => void;
  select: (path: string | null) => void;
}

/** Texts of notes opened this session; the rest stay in their files. */
const contents = new Map<string, string>();
const listeners = new Set<(changed: string[]) => void>();
/** Tells open editors which notes changed on disk (another app, the phone through iCloud). */
export function onContentsChanged(cb: (changed: string[]) => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const emit = (changed: string[]) => { if (changed.length) listeners.forEach((l) => l(changed)); };

/** The text the app last read or wrote for a note, to tell its own saves from changes made elsewhere. */
export const knownText = (path: string) => contents.get(path);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function parseMeta(text: string | null | undefined): VaultMeta {
  try {
    if (text) return { pinned: [], tagIcons: {}, ...JSON.parse(text) };
  } catch {}
  return { pinned: [], tagIcons: {} };
}

const summary = async () => {
  const [counts, rows] = await Promise.all([api.counts(), api.tagCounts()]);
  return { counts, tags: buildTags(rows) };
};

async function uniquePath(folder: string, base: string, ext = '.md'): Promise<string> {
  let candidate = joinPath(folder, base + ext);
  let n = 2;
  while (await api.exists(candidate)) candidate = joinPath(folder, `${base} ${n++}${ext}`);
  return candidate;
}

let lastSelfWrite = 0;
const wrote = () => { lastSelfWrite = Date.now(); };
let unlisten: (() => void) | undefined;

export const useNotes = create<NotesState>((set, get) => {
  let refreshing: Promise<void> | null = null;

  const writeMeta = async (patch: Partial<VaultMeta>) => {
    wrote();
    const [text] = await api.readFiles([META_PATH]);
    // Tag icons are picked on the phone; keep them.
    await api.writeFile(META_PATH, JSON.stringify({ ...parseMeta(text), pinned: get().pinned, ...patch }, null, 2));
  };

  const applyMove = async (from: string, to: string) => {
    wrote();
    const { mtime } = await api.moveFile(from, to);
    const text = contents.get(from);
    contents.delete(from);
    if (text !== undefined) contents.set(to, text);
    await api.move(from, to, sectionOf(to), mtime);
    let { pinned } = get();
    if (pinned.includes(from)) {
      pinned = pinned.map((p) => (p === from ? to : p));
      set({ pinned });
      await writeMeta({ pinned });
    }
    const sum = await summary();
    set((s) => ({ ...sum, revision: s.revision + 1, selected: s.selected === from ? to : s.selected }));
    emit([from, to]);
    return to;
  };

  return {
    folder: null,
    scanned: false,
    tags: [],
    counts: EMPTY_COUNTS,
    pinned: [],
    revision: 0,
    section: 'notes',
    tag: '',
    selected: null,
    fresh: null,

    openFolder: async (path) => {
      try {
        await api.openFolder(path);
      } catch (e) {
        set({ error: String(e) });
        return;
      }
      try { localStorage.setItem(FOLDER_KEY, path); } catch {}
      contents.clear();
      // The index from last time shows at once; the scan below brings it up to date.
      const sum = await summary();
      set((s) => ({ folder: path, error: undefined, scanned: false, selected: null, ...sum, revision: s.revision + 1 }));
      unlisten?.();
      unlisten = await listen('folder-changed', () => {
        // Our own saves fire the watcher too.
        if (Date.now() - lastSelfWrite > SELF_WRITE_MS) void get().refresh();
      });
      await get().refresh();
    },

    refresh: async () => {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const { folder } = get();
        if (!folder) return;
        const [entries, [metaText], knownRows] = await Promise.all([api.scan(), api.readFiles([META_PATH]), api.known()]);
        const meta = parseMeta(metaText);
        const known = new Map(knownRows.map((k) => [k.path, k]));
        // A first scan fills the list batch by batch; later ones change it once, at the end.
        const filling = known.size === 0;
        // Only files that are new or changed size or date are read. A note only in iCloud keeps its row.
        const stale = entries.filter((e) => {
          if (e.cloud) return false;
          const k = known.get(e.path);
          return !k || k.mtime !== e.mtime || k.size !== e.size;
        });
        const present = new Set(entries.map((e) => e.path));
        const gone = [...known.keys()].filter((p) => !present.has(p));
        const changed: string[] = [];
        for (let i = 0; i < stale.length; i += SCAN_BATCH) {
          const part = stale.slice(i, i + SCAN_BATCH);
          const texts = await api.readFiles(part.map((e) => e.path));
          if (get().folder !== folder) return;
          const batch: NoteRecord[] = [];
          part.forEach((e, j) => {
            const text = texts[j];
            if (text == null) return;
            if (contents.has(e.path)) contents.set(e.path, text);
            batch.push(recordFrom(e.path, e.mtime, e.size, text));
          });
          await api.put(batch, meta.pinned);
          changed.push(...batch.map((r) => r.path));
          if (filling) set((s) => ({ revision: s.revision + 1 }));
        }
        if (get().folder !== folder) return;
        if (gone.length) {
          await api.remove(gone);
          gone.forEach((p) => contents.delete(p));
          changed.push(...gone);
        }
        await api.setPinned(meta.pinned);
        const pinsMoved = !same(meta.pinned, get().pinned);
        const sum = changed.length || pinsMoved ? await summary() : null;
        // When nothing changed only `scanned` is set, so the list doesn't redraw.
        set((s) => ({
          scanned: true,
          ...(pinsMoved ? { pinned: meta.pinned } : null),
          ...(sum ? { ...sum, revision: s.revision + 1 } : null),
        }));
        emit(changed);
      })().finally(() => { refreshing = null; });
      return refreshing;
    },

    readText: async (path) => {
      const cached = contents.get(path);
      if (cached !== undefined) return cached;
      const [text] = await api.readFiles([path]);
      if (text == null) throw new Error(`Couldn't read ${path}`);
      contents.set(path, text);
      return text;
    },

    createNote: async (initial = '') => {
      // A note made with its title is named after it at once.
      const path = await uniquePath('', fileNameFromTitle(splitTitle(initial).title));
      wrote();
      const { mtime, size } = await api.writeFile(path, initial);
      contents.set(path, initial);
      await api.put([recordFrom(path, mtime, size, initial)], get().pinned);
      const sum = await summary();
      set((s) => ({ ...sum, revision: s.revision + 1, section: 'notes', selected: path, fresh: path }));
      return path;
    },

    saveNote: async (path, md) => {
      const before = await api.get(path);
      // Moved to Trash or deleted while the editor was closing; or nothing changed.
      if (!before || contents.get(path) === md) return;
      wrote();
      contents.set(path, md);
      const { mtime, size } = await api.writeFile(path, md);
      const record = recordFrom(path, mtime, size, md);
      await api.put([record], get().pinned);
      // Only rebuild the tag tree (and redraw the sidebar) when the tags changed.
      const sum = same(before?.tags, record.tags) ? null : await summary();
      set((s) => ({ ...sum, revision: s.revision + 1 }));
    },

    /** Renames the file so its name follows the first line, like the phone app. Returns the (maybe new) path. */
    syncTitle: async (path) => {
      const text = contents.get(path);
      if (text === undefined || !(await api.get(path))) return path;
      const { title } = splitTitle(text);
      const wanted = fileNameFromTitle(title);
      const current = basename(path).replace(/\.(md|markdown|txt)$/i, '');
      if (!title || wanted === current) return path;
      return applyMove(path, await uniquePath(dirname(path), wanted));
    },

    moveTo: async (path, folder) => {
      const base = basename(path).replace(/\.(md|markdown|txt)$/i, '');
      return applyMove(path, await uniquePath(folder, base));
    },
    trash: (path) => get().moveTo(path, RESERVED_FOLDERS.trash),
    archive: (path) => get().moveTo(path, RESERVED_FOLDERS.archive),
    restore: (path) => get().moveTo(path, ''),

    deleteForever: async (path) => {
      wrote();
      await api.removeFile(path);
      contents.delete(path);
      await api.remove([path]);
      const sum = await summary();
      set((s) => ({ ...sum, revision: s.revision + 1, selected: s.selected === path ? null : s.selected }));
    },

    togglePin: async (path) => {
      const { pinned } = get();
      const next = pinned.includes(path) ? pinned.filter((p) => p !== path) : [...pinned, path];
      set({ pinned: next });
      await writeMeta({ pinned: next });
      await api.setPinned(next);
      set((s) => ({ revision: s.revision + 1 }));
    },

    show: (section, tag = '') => set({ section, tag, selected: null }),
    select: (path) => set({ selected: path, fresh: null }),
  };
});

/** The folder chosen last time, if any. */
export const savedFolder = () => { try { return localStorage.getItem(FOLDER_KEY); } catch { return null; } };

/** Reads from the index again whenever a note changes. */
function useIndexQuery<T>(read: () => Promise<T>, empty: T, deps: unknown[]): T {
  const revision = useNotes((s) => s.revision);
  const folder = useNotes((s) => s.folder);
  const [value, setValue] = useState(empty);
  useEffect(() => {
    if (!folder) return;
    let live = true;
    read().then((v) => { if (live) setValue(v); }).catch((e) => console.warn(e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` is rebuilt each render; `deps` say when it changes.
  }, [folder, revision, ...deps]);
  return value;
}

/** The newest `limit` notes of a section (and tag), pinned first; or the notes matching `query`. */
export function useNoteList(section: Section, tag: string, query: string, limit: number): { notes: NoteMeta[]; snippets?: Map<string, string> } {
  return useIndexQuery(
    async () => {
      if (!query.trim()) return { notes: await api.list(section, tag, limit) };
      const hits: Hit[] = await api.search(query, section, limit);
      return { notes: hits.map((h) => h.note), snippets: new Map(hits.map((h) => [h.note.path, h.snippet])) };
    },
    { notes: [] },
    [section, tag, query, limit],
  );
}

export function useNote(path: string | null): NoteMeta | null {
  return useIndexQuery(async () => (path ? api.get(path) : null), null, [path]);
}

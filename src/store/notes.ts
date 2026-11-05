import { useMemo } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { kvDel } from '@/utils/kv';
import { fileNameFromTitle, followsTitle, splitTitle } from '@/utils/markdown';
import {
  META_PATH, RESERVED_FOLDERS, basename, dirname, folderNotChosen, joinPath, openSavedVault,
  type Vault, type VaultMeta,
} from '@/vault';
import { openNoteDb, type NoteDb } from './noteDb';
import { welcomeOnce } from './welcome';
import { WELCOME_TITLE, WELCOME_VERSION } from './welcomeNote';
import { BOOKMARKS, buildTags, byDate, cleanHiddenTags, recordFrom, sectionOf, type NoteMeta, type NoteRecord, type Section, type SectionCounts, type TagNode } from './noteModel';
import { timeFolder, timeScan } from '@/utils/launchTiming';

export { BOOKMARKS, UNTAGGED, sectionOf, tagOf, type NoteMeta, type Section, type SectionCounts, type TagNode } from './noteModel';

interface NotesState {
  vault: Vault | null;
  /** The note index of the open folder (see `noteDb.ts`). */
  db: NoteDb | null;
  status: 'ready' | 'error';
  /** The folder has been scanned once since it was opened, so the index lists every note. */
  scanned: boolean;
  error?: string;
  /** The picked notes folder could not be opened at launch; shown in settings. */
  vaultProblem?: string;
  /** A first launch on an iPhone: the app asks where notes live (`FolderChoice`) before it writes anything. */
  needsFolder: boolean;
  tags: TagNode[];
  counts: SectionCounts;
  pinned: string[];
  /** Bookmarked notes, in the order they were added (`VaultMeta.bookmarks`). */
  bookmarks: string[];
  /** Icons picked by hand, by tag path. Tags without one use `defaultTagIcon`. */
  tagIcons: Record<string, string>;
  /** Tag names kept out of the main Notes list (`VaultMeta.hiddenTags`). */
  hiddenTags: string[];
  /** Goes up whenever a note changes; lists read the index again. */
  revision: number;

  boot: () => Promise<void>;
  setVault: (v: Vault) => Promise<void>;
  /** The folder picked on a first launch: opened, then booted (scan, welcome note, watcher). */
  startIn: (v: Vault) => Promise<void>;
  refresh: () => Promise<void>;
  /** The note's text if it is open or was just read; else read from the file at once (one small file). */
  getText: (path: string) => string | undefined;
  loadText: (path: string) => Promise<string>;
  /** Reads a note without keeping it, for the meaning index going through every note. */
  readText: (path: string) => Promise<string>;
  createNote: (initial?: string) => Promise<string>;
  saveNote: (path: string, md: string) => Promise<void>;
  syncTitle: (path: string) => Promise<string>;
  moveTo: (path: string, folder: string) => Promise<string>;
  trash: (path: string) => Promise<string>;
  restore: (path: string) => Promise<string>;
  deleteForever: (path: string) => Promise<void>;
  togglePin: (path: string) => Promise<void>;
  toggleBookmark: (path: string) => Promise<void>;
  /** `null` goes back to the default icon. */
  setTagIcon: (tag: string, icon: string | null) => Promise<void>;
  setHiddenTags: (names: string[]) => Promise<void>;
}

/** Texts of notes opened this session; the rest stay in their files. */
const contents = new Map<string, string>();
const listeners = new Set<(changed: string[]) => void>();
export function onContentsChanged(cb: (changed: string[]) => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
/** Where moved notes went ('' = deleted), so a late save from a closing editor follows the file. */
const movedTo = new Map<string, string>();
const resolvePath = (p: string) => { let q = p; for (let i = 0; i < 8 && q && movedTo.has(q); i++) q = movedTo.get(q)!; return q; };
const emit = (changed: string[]) => { if (changed.length) listeners.forEach((l) => l(changed)); };

/** The note list cache before the index (one JSON of every note); deleted at launch. */
const OLD_CACHE_KEY = 'notes.index.v2';
/** Watch events this soon after our own write are our own echo. */
const SELF_WRITE_MS = 2000;
/** Files read at a time in a folder scan; the list fills batch by batch on a first scan. */
const SCAN_BATCH = 100;

const EMPTY_COUNTS: SectionCounts = { notes: 0, archive: 0, trash: 0, untagged: 0 };

/** The library's numbers and tag tree, from the index. */
const summary = (db: NoteDb, hidden: readonly string[]) => ({ counts: db.counts(hidden), tags: buildTags(db.tagCounts()) });


const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function parseMeta(text: string | undefined): VaultMeta {
  try {
    if (text) return { pinned: [], tagIcons: {}, hiddenTags: [], bookmarks: [], ...JSON.parse(text) };
  } catch {}
  return { pinned: [], tagIcons: {}, hiddenTags: [], bookmarks: [] };
}

/** A file's date and size as the next folder scan will see them, so that scan doesn't read it again. */
const statOf = (vault: Vault, path: string, text: string) => vault.stat?.(path) ?? { mtime: Date.now(), size: text.length };

/**
 * The saved folder with its index and pins, opened at once when the app starts: the first frame
 * already lists last time's notes in the right theme, instead of a blank list that fills in.
 */
function openAtLaunch(): Partial<NotesState> {
  try {
    const { vault, problem, meta } = timeFolder(() => {
      const opened = openSavedVault();
      let text: string | undefined;
      try { text = opened.vault.readSync?.(META_PATH); } catch {}
      return { ...opened, meta: text };
    });
    const db = openNoteDb(vault.id);
    const { pinned, tagIcons, hiddenTags = [], bookmarks = [] } = parseMeta(meta);
    return { vault, db, vaultProblem: problem, needsFolder: folderNotChosen(), status: 'ready', pinned, bookmarks, tagIcons, hiddenTags, ...summary(db, hiddenTags) };
  } catch (e: any) {
    return { status: 'error', error: String(e?.message ?? e) };
  }
}

const sameTags = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

async function uniquePath(vault: Vault, folder: string, base: string, ext = '.md'): Promise<string> {
  let candidate = joinPath(folder, base + ext);
  let n = 2;
  while (await vault.exists(candidate)) candidate = joinPath(folder, `${base} ${n++}${ext}`);
  return candidate;
}

export const useNotes = create<NotesState>((set, get) => {
  let refreshing: Promise<void> | null = null;
  let lastSelfWrite = 0;
  const wrote = () => { lastSelfWrite = Date.now(); };
  let stopWatching: (() => void) | undefined;
  let cloudRetry: ReturnType<typeof setTimeout> | null = null;
  const startWatching = (vault: Vault) => {
    stopWatching?.();
    stopWatching = vault.watch?.(() => {
      // Our own saves fire the watcher too; rescanning the whole folder for them made typing lag.
      if (Date.now() - lastSelfWrite < SELF_WRITE_MS) return;
      void get().refresh();
    });
  };

  const readMeta = async (vault: Vault) => parseMeta(await vault.read(META_PATH).catch(() => undefined));
  /** Writes the meta file with `patch` over what the app holds now. */
  const writeMeta = async (vault: Vault, patch: Partial<VaultMeta>) => {
    wrote();
    const { pinned, bookmarks, tagIcons, hiddenTags } = get();
    // What the app doesn't hold (the welcome note's version, fields from a newer app) stays.
    const kept = await readMeta(vault);
    await vault.write(META_PATH, JSON.stringify({ ...kept, pinned, bookmarks, tagIcons, hiddenTags, ...patch }, null, 2));
  };

  const open = () => {
    const { vault, db } = get();
    if (!vault || !db) throw new Error('No vault');
    return { vault, db };
  };

  const applyMove = async (from: string, to: string) => {
    const { vault, db } = open();
    wrote();
    await vault.move(from, to);
    movedTo.set(from, to);
    const text = contents.get(from);
    contents.delete(from);
    if (text !== undefined) contents.set(to, text);
    db.move(from, to, sectionOf(to), vault.stat?.(to)?.mtime ?? Date.now());
    // Pins and bookmarks follow the note.
    const follow = (paths: string[]) => (paths.includes(from) ? paths.map((p) => (p === from ? to : p)) : paths);
    const { pinned, bookmarks } = get();
    const nextPinned = follow(pinned);
    const nextBookmarks = follow(bookmarks);
    if (nextPinned !== pinned || nextBookmarks !== bookmarks) await writeMeta(vault, { pinned: nextPinned, bookmarks: nextBookmarks });
    set((s) => ({ ...summary(db, get().hiddenTags), pinned: nextPinned, bookmarks: nextBookmarks, revision: s.revision + 1 }));
    emit([from, to]);
    void get().refresh();
    return to;
  };

  return {
    vault: null,
    db: null,
    status: 'ready',
    scanned: false,
    tags: [],
    counts: EMPTY_COUNTS,
    pinned: [],
    bookmarks: [],
    tagIcons: {},
    hiddenTags: [],
    revision: 0,
    needsFolder: false,
    ...openAtLaunch(),

    boot: async () => {
      // The index from last time is already showing (`openAtLaunch`); the folder scan brings it up to date.
      const { vault, needsFolder } = get();
      if (!vault || needsFolder) return;
      try {
        void kvDel(OLD_CACHE_KEY);
        await timeScan(get().refresh);
        if (await welcomeOnce(vault, await readMeta(vault), () => uniquePath(vault, RESERVED_FOLDERS.trash, WELCOME_TITLE))) {
          await writeMeta(vault, { welcome: WELCOME_VERSION });
          await get().refresh();
        }
        startWatching(vault);
        // Files may have changed through iCloud/Drive while the app slept.
        AppState.addEventListener('change', (s) => { if (s === 'active') void get().refresh(); });
      } catch (e: any) {
        set({ status: 'error', error: String(e?.message ?? e) });
      }
    },

    setVault: async (vault) => {
      const old = get().db;
      const db = openNoteDb(vault.id);
      contents.clear();
      set((s) => ({ vault, db, vaultProblem: undefined, pinned: [], bookmarks: [], tagIcons: {}, hiddenTags: [], status: 'ready', scanned: false, ...summary(db, []), revision: s.revision + 1 }));
      // A scan of the old folder may still be running; let it finish (and be dropped) first.
      await refreshing?.catch(() => {});
      if (old !== db) old?.close();
      await get().refresh();
      startWatching(vault);
    },

    startIn: async (vault) => {
      const db = openNoteDb(vault.id);
      const old = get().db;
      set((s) => ({ vault, db, needsFolder: false, vaultProblem: undefined, pinned: [], bookmarks: [], tagIcons: {}, hiddenTags: [], status: 'ready', scanned: false, ...summary(db, []), revision: s.revision + 1 }));
      if (old !== db) old?.close();
      await get().boot();
    },

    refresh: async () => {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const { vault, db } = get();
        if (!vault || !db) return;
        // Notes only in iCloud come down in the background; look again once some may have landed.
        void vault.fetchFromCloud?.().then((n) => {
          if (!n || cloudRetry) return;
          cloudRetry = setTimeout(() => { cloudRetry = null; void get().refresh(); }, 5000);
        });
        const entries = (await vault.list()).filter((e) => !e.isDir);
        const meta = await readMeta(vault);
        const pinnedSet = new Set(meta.pinned);
        const known = db.known();
        // A first scan fills the list batch by batch. Later ones change it once, at the end, so a
        // relaunch doesn't make it twitch.
        const filling = known.size === 0;
        // Only files that are new or changed size or date are read. A note only in iCloud keeps
        // its row until it comes down.
        const stale = entries.filter((e) => {
          if (e.cloud) return false;
          const k = known.get(e.path);
          return !k || k.mtime !== e.mtime || k.size !== e.size;
        });
        const present = new Set(entries.map((e) => e.path));
        const gone = [...known.keys()].filter((p) => !present.has(p));
        const changed: string[] = [];
        for (let i = 0; i < stale.length; i += SCAN_BATCH) {
          const read = await Promise.all(stale.slice(i, i + SCAN_BATCH).map(async (e) => {
            try {
              const text = await vault.read(e.path);
              if (contents.has(e.path)) contents.set(e.path, text);
              return recordFrom(e.path, e.mtime, e.size, text);
            } catch (err) {
              console.warn('read failed', e.path, err);
              return null;
            }
          }));
          // A scan of a folder switched away from mid-way is thrown away.
          if (get().db !== db) return;
          const batch = read.filter((r): r is NoteRecord => r !== null);
          db.put(batch, pinnedSet);
          changed.push(...batch.map((r) => r.path));
          if (filling) set((s) => ({ revision: s.revision + 1 }));
        }
        if (get().db !== db) return;
        if (gone.length) {
          db.remove(gone);
          gone.forEach((p) => contents.delete(p));
          changed.push(...gone);
        }
        db.setPinned(meta.pinned);
        const pinsMoved = !same(meta.pinned, get().pinned);
        const hiddenTags = meta.hiddenTags ?? [];
        const hiddenMoved = !same(hiddenTags, get().hiddenTags);
        const bookmarks = meta.bookmarks ?? [];
        // When nothing changed only `scanned` is set, so the list doesn't redraw.
        set((s) => ({
          scanned: true,
          ...(pinsMoved ? { pinned: meta.pinned } : null),
          ...(same(bookmarks, s.bookmarks) ? null : { bookmarks }),
          ...(hiddenMoved ? { hiddenTags } : null),
          ...(same(meta.tagIcons, s.tagIcons) ? null : { tagIcons: meta.tagIcons }),
          ...(changed.length || pinsMoved || hiddenMoved ? { ...summary(db, hiddenTags), revision: s.revision + 1 } : null),
        }));
        emit(changed);
      })().finally(() => { refreshing = null; });
      return refreshing;
    },

    getText: (path) => {
      let text = contents.get(path);
      if (text !== undefined) return text;
      try { text = get().vault?.readSync?.(path); } catch {}
      if (text !== undefined) contents.set(path, text);
      return text;
    },

    loadText: async (path) => {
      const cached = contents.get(path);
      if (cached !== undefined) return cached;
      const { vault } = open();
      const text = await vault.read(path);
      contents.set(path, text);
      return text;
    },

    readText: async (path) => contents.get(path) ?? open().vault.read(path),

    createNote: async (initial = '') => {
      const { vault, db } = open();
      // A note made with its title (from the finder) is named after it at once.
      const path = await uniquePath(vault, '', fileNameFromTitle(splitTitle(initial).title));
      wrote();
      await vault.write(path, initial);
      contents.set(path, initial);
      const { mtime, size } = statOf(vault, path, initial);
      db.put([recordFrom(path, mtime, size, initial)], new Set(get().pinned));
      set((s) => ({ ...summary(db, get().hiddenTags), revision: s.revision + 1 }));
      return path;
    },

    saveNote: async (requested, md) => {
      const { vault, db } = open();
      const path = db.get(requested) || !movedTo.has(requested) ? requested : resolvePath(requested);
      if (!path) return; // deleted while the editor was closing
      if (contents.get(path) === md) return;
      wrote();
      await vault.write(path, md);
      contents.set(path, md);
      const before = db.get(path);
      const { mtime, size } = statOf(vault, path, md);
      const record = recordFrom(path, mtime, size, md);
      db.put([record], new Set(get().pinned));
      // Only rebuild the tag tree (and re-render the sidebar) when the tags changed.
      set((s) => (sameTags(before?.tags, record.tags) ? { revision: s.revision + 1 } : { ...summary(db, get().hiddenTags), revision: s.revision + 1 }));
      emit([path]);
    },

    /** Renames the file so its name follows the first line, like Bear/Obsidian do. Returns the (maybe new) path. */
    syncTitle: async (path) => {
      const { vault, db } = get();
      if (!vault || !db) return path;
      const text = contents.get(path);
      if (!db.get(path) || text === undefined) return path;
      const { title } = splitTitle(text);
      const wanted = fileNameFromTitle(title);
      const current = basename(path).replace(/\.(md|markdown|txt)$/i, '');
      if (!title || followsTitle(current, wanted)) return path;
      const target = await uniquePath(vault, dirname(path), wanted);
      return applyMove(path, target);
    },

    moveTo: async (path, folder) => {
      const { vault } = open();
      const base = basename(path).replace(/\.(md|markdown|txt)$/i, '');
      const target = await uniquePath(vault, folder, base);
      return applyMove(path, target);
    },
    trash: (path) => get().moveTo(path, RESERVED_FOLDERS.trash),
    restore: (path) => get().moveTo(path, ''),

    deleteForever: async (path) => {
      const { vault, db } = open();
      wrote();
      await vault.remove(path);
      movedTo.set(path, '');
      contents.delete(path);
      db.remove([path]);
      set((s) => ({ ...summary(db, get().hiddenTags), revision: s.revision + 1 }));
      emit([path]);
    },

    togglePin: async (path) => {
      const { vault, db, pinned } = get();
      if (!vault || !db) return;
      const next = pinned.includes(path) ? pinned.filter((p) => p !== path) : [...pinned, path];
      await writeMeta(vault, { pinned: next });
      db.setPinned(next);
      // A pinned note of a hidden tag shows in Notes, so its count changes too.
      set((s) => ({ pinned: next, ...summary(db, get().hiddenTags), revision: s.revision + 1 }));
    },

    toggleBookmark: async (path) => {
      const { vault, bookmarks } = get();
      if (!vault) return;
      const next = bookmarks.includes(path) ? bookmarks.filter((p) => p !== path) : [...bookmarks, path];
      set({ bookmarks: next });
      await writeMeta(vault, { bookmarks: next });
    },

    setTagIcon: async (tag, icon) => {
      const { vault, tagIcons } = get();
      if (!vault) return;
      const next = { ...tagIcons };
      if (icon) next[tag] = icon; else delete next[tag];
      set({ tagIcons: next });
      await writeMeta(vault, { tagIcons: next });
    },

    setHiddenTags: async (names) => {
      const { vault, db } = get();
      if (!vault || !db) return;
      const hiddenTags = cleanHiddenTags(names);
      set((s) => ({ hiddenTags, ...summary(db, hiddenTags), revision: s.revision + 1 }));
      await writeMeta(vault, { hiddenTags });
    },

  };
});

/** Bookmarked notes in the order they were bookmarked; notes in Trash or gone are left out. */
const bookmarked = (db: NoteDb, paths: string[]) =>
  paths.map((p) => db.get(p)).filter((n): n is NoteMeta => !!n && sectionOf(n.path) !== 'trash');

/** The newest `limit` notes of a section, of one tag (and its nested tags), Untagged or Bookmarks; pinned first. */
export function useNoteList(section: Section, tag: string, limit: number): NoteMeta[] {
  const db = useNotes((s) => s.db);
  const revision = useNotes((s) => s.revision);
  const hidden = useNotes((s) => s.hiddenTags);
  const bookmarks = useNotes((s) => s.bookmarks);
  const marks = tag === BOOKMARKS ? bookmarks : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision`: the index changed, read it again.
  return useMemo(() => (!db ? [] : marks ? byDate(bookmarked(db, marks)).slice(0, limit) : db.list(section, tag, limit, hidden)), [db, section, tag, limit, hidden, marks, revision]);
}

export function useNote(path: string | null | undefined): NoteMeta | null {
  const db = useNotes((s) => s.db);
  const revision = useNotes((s) => s.revision);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision`: the index changed, read it again.
  return useMemo(() => (db && path ? db.get(path) : null), [db, path, revision]);
}

/** The bookmarked notes, in the order they were bookmarked, for the library's Bookmarks fold. */
export function useBookmarked(): NoteMeta[] {
  const db = useNotes((s) => s.db);
  const bookmarks = useNotes((s) => s.bookmarks);
  const revision = useNotes((s) => s.revision);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision`: the index changed, read it again.
  return useMemo(() => (db ? bookmarked(db, bookmarks) : []), [db, bookmarks, revision]);
}

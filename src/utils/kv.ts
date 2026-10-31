// Tiny JSON key/value store for app-private state, one JSON file per key: settings in the app's
// documents (kept in backups), and what the app can rebuild (indexes) in its caches.
import { Directory, File, Paths } from 'expo-file-system';

const fileName = (key: string) => `${key.replace(/[^a-z0-9._-]/gi, '_')}.json`;

function dirAt(parent: Directory, name: string) {
  const dir = new Directory(parent, name);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Settings and the notes folder's location: small, backed up, hidden from the Files app by the dot. */
const kvDir = () => dirAt(Paths.document, '.vbnotes-kv');

/**
 * What the app can rebuild from the notes (the note index, the meaning index): in Caches, so it
 * stays out of iCloud backups and the Files app, as Apple's storage rules ask. iOS may clear it when
 * the phone runs out of space; it is then rebuilt.
 */
export const cacheDir = () => dirAt(Paths.cache, 'vbnotes');

/** Indexes made before 0.2 sat in the documents (backed up); they move once, so nothing is rebuilt. */
let moved = false;
export function moveIndexesToCache() {
  if (moved) return;
  moved = true;
  try {
    const old = new Directory(Paths.document, '.vbnotes-kv');
    if (!old.exists) return;
    const to = cacheDir();
    for (const f of old.list()) {
      if (!(f instanceof File) || !/^(notes\..+\.db(-wal|-shm)?|semantic\.index\..+\.json)$/.test(f.name)) continue;
      if (new File(to, f.name).exists) f.delete(); else f.move(to);
    }
  } catch (e) {
    console.warn('could not move the indexes to caches', e);
  }
}

const nativeFile = (key: string, dir = kvDir) => new File(dir(), fileName(key));

export async function kvGet<T>(key: string, dir = kvDir): Promise<T | null> {
  try {
    const f = nativeFile(key, dir);
    if (!f.exists) return null;
    return JSON.parse(await f.text()) as T;
  } catch (e) {
    console.warn('kvGet failed', key, e);
    return null;
  }
}

/** Same as `kvGet`, at once: what the first frame needs (settings, the notes folder). */
export function kvGetSync<T>(key: string): T | null {
  try {
    const f = nativeFile(key);
    return f.exists ? (JSON.parse(f.textSync()) as T) : null;
  } catch (e) {
    console.warn('kvGet failed', key, e);
    return null;
  }
}

export async function kvSet<T>(key: string, value: T, dir = kvDir): Promise<void> {
  try {
    await nativeFile(key, dir).write(JSON.stringify(value));
  } catch (e) {
    console.warn('kvSet failed', key, e);
  }
}

export async function kvDel(key: string): Promise<void> {
  try {
    const f = nativeFile(key);
    if (f.exists) f.delete();
  } catch (e) {
    console.warn('kvDel failed', key, e);
  }
}

/** Deletes every key starting with `prefix` except `keep`, e.g. the index of a model no longer used. */
export async function kvPrune(prefix: string, keep: string, dir = kvDir): Promise<void> {
  try {
    const start = fileName(prefix).slice(0, -'.json'.length);
    for (const f of dir().list()) {
      if (f instanceof File && f.name.startsWith(start) && f.name !== fileName(keep)) f.delete();
    }
  } catch (e) {
    console.warn('kvPrune failed', prefix, e);
  }
}

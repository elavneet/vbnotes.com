// Tiny JSON key/value store for app-private state (settings, embedding cache).
// One JSON file per key in the app's document folder.
import { Directory, File, Paths } from 'expo-file-system';

const fileName = (key: string) => `${key.replace(/[^a-z0-9._-]/gi, '_')}.json`;

function kvDir() {
  const dir = new Directory(Paths.document, '.vbnotes-kv');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

const nativeFile = (key: string) => new File(kvDir(), fileName(key));

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const f = nativeFile(key);
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

export async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    await nativeFile(key).write(JSON.stringify(value));
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
export async function kvPrune(prefix: string, keep: string): Promise<void> {
  try {
    const start = fileName(prefix).slice(0, -'.json'.length);
    for (const f of kvDir().list()) {
      if (f instanceof File && f.name.startsWith(start) && f.name !== fileName(keep)) f.delete();
    }
  } catch (e) {
    console.warn('kvPrune failed', prefix, e);
  }
}

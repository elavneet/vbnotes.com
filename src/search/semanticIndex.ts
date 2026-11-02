import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { File } from 'expo-file-system';
import { cacheDir, kvGet, kvPrune, moveIndexesToCache } from '@/utils/kv';
import { hashText } from '@/utils/markdown';
import { chunkNote } from './chunks';
import { cosine, getEmbedder, normalize, type Embedder } from './embedder';
import { DEFAULT_SEARCH_MODEL, searchModel, type SearchModelId } from './models';

/**
 * Note → vectors. Every note is split into chunks sized for the model (title prepended to each so
 * context is never lost). The vectors live in a SQLite file per model in the app's caches
 * (`meaning.<model>.db`), keyed by the note's content hash, so re-opening the app never re-embeds
 * unchanged notes. A launch reads only the hashes; the vectors are read on the first search and kept
 * in memory from then on. Brute-force cosine is plenty for thousands of notes: 2000 notes × 3 chunks
 * × 1024 dims ≈ 6M multiplies.
 *
 * Until 0.4.7 the whole index was one JSON file (6 MB for 700 notes), read at every launch and
 * written again whole after every change; it moves into the database once and is deleted.
 */
const OLD_JSON_KEY = 'semantic.index.v2.';
const VERSION = 1;
const SCHEMA = `
CREATE TABLE notes (path TEXT PRIMARY KEY, hash TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE chunks (path TEXT NOT NULL, i INTEGER NOT NULL, text TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (path, i)) WITHOUT ROWID;
`;
/** Notes in a row the model can't read before the run stops (the model itself is broken). */
const MAX_FAILED_NOTES = 5;

/** A vector as int8 plus one float32 scale in front: a quarter of float32's size. Cosine barely moves. */
function pack(v: Float32Array): Uint8Array {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
  const scale = max / 127 || 1;
  const bytes = new Uint8Array(v.length + 4);
  new DataView(bytes.buffer).setFloat32(0, scale, true);
  for (let i = 0; i < v.length; i++) bytes[4 + i] = Math.round(v[i] / scale) & 0xff;
  return bytes;
}

function unpack(bytes: Uint8Array): Float32Array {
  const scale = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true);
  const out = new Float32Array(bytes.length - 4);
  for (let i = 0; i < out.length; i++) out[i] = ((bytes[4 + i] << 24) >> 24) * scale;
  return normalize(out);
}

/** The old JSON index stored the same bytes as base64. */
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Vectors for a note's chunks. A chunk the model fails on is tried again shorter (the export can
 * reject lengths its metadata allows); one that still fails is left out. Throws when none can be read.
 */
async function readChunks(embedder: Embedder, chunks: string[]): Promise<{ chunks: string[]; vecs: Float32Array[] }> {
  if (!chunks.length) return { chunks, vecs: [] };
  try {
    return { chunks, vecs: await embedder.embed(chunks, 'document') };
  } catch (e) {
    const kept: string[] = [];
    const vecs: Float32Array[] = [];
    for (const chunk of chunks) {
      for (let words = chunk.split(' '); words.length >= 8; words = words.slice(0, Math.floor(words.length / 2))) {
        try {
          vecs.push((await embedder.embed([words.join(' ')], 'document'))[0]);
          kept.push(chunk);
          break;
        } catch {
          // Shorter next time round.
        }
      }
    }
    if (!vecs.length) throw e;
    return { chunks: kept, vecs };
  }
}

export interface SemanticHit { path: string; score: number; chunk: string }

/** Where notes come from: the hash to tell what changed without reading, then the text to embed. */
export interface NoteSource {
  /** `hashText` of the note, or undefined once it is gone. */
  hash: (path: string) => string | undefined;
  text: (path: string) => Promise<string | undefined>;
}

type Listener = () => void;
type OldJson = Record<string, { hash: string; chunks: string[]; vecs: string[] }>;

/** The database for one model's vectors; other models' files are deleted (their notes are embedded again). */
function openIndex(embedderId: string): SQLiteDatabase {
  moveIndexesToCache();
  const name = `meaning.${embedderId.replace(/[^\w.-]/g, '_')}.db`;
  try {
    for (const f of cacheDir().list()) {
      if (f instanceof File && f.name.startsWith('meaning.') && !f.name.startsWith(name)) f.delete();
    }
  } catch (e) {
    console.warn('old meaning indexes not removed', e);
  }
  const db = openDatabaseSync(name, undefined, cacheDir().uri);
  db.execSync('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  const version = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version;
  if (version !== VERSION) db.execSync(`DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS chunks; ${SCHEMA} PRAGMA user_version = ${VERSION};`);
  return db;
}

export class SemanticIndex {
  /** The hash of the text each note's vectors were made from; read at launch. */
  private hashes = new Map<string, string>();
  /** Every chunk's vector by note, read on the first search. */
  private vectors: Map<string, Float32Array[]> | null = null;
  private db: SQLiteDatabase | null = null;
  private embedder: Embedder | null = null;
  private queue = new Set<string>();
  private running = false;
  private listeners = new Set<Listener>();
  pending = 0;
  indexed = 0;
  private model: SearchModelId = DEFAULT_SEARCH_MODEL;
  private creating: Promise<Embedder> | null = null;

  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private notify() { this.pending = this.queue.size; this.indexed = this.hashes.size; this.listeners.forEach((l) => l()); }

  /**
   * Picks the model. A different one starts over: the old vectors cannot be compared with
   * the new model's, so every note is embedded again (`useIndexing` schedules them).
   */
  setModel(id: SearchModelId) {
    if (id === this.model) return;
    this.model = id;
    this.embedder?.dispose();
    this.embedder = null;
    this.creating = null;
    this.hashes.clear();
    this.vectors = null;
    this.queue.clear();
    try { this.db?.closeSync(); } catch {}
    this.db = null;
    this.notify();
  }

  async ensureEmbedder(onProgress?: (p: number) => void) {
    if (!this.embedder) {
      const model = this.model;
      this.creating ??= getEmbedder(searchModel(model));
      const created = await this.creating;
      if (model !== this.model) throw new Error('search model changed');
      this.embedder ??= created;
    }
    // The search and settings screens redraw on notify: the download % and status
    // only moved when something else changed, so a long download looked stuck.
    const embedder = this.embedder;
    let shown = embedder.progress;
    try {
      const loading = embedder.load((p) => {
        onProgress?.(p);
        if (p !== shown) { shown = p; this.notify(); }
      });
      this.notify(); // now "loading"
      await loading;
    } finally {
      this.notify();
    }
    if (embedder !== this.embedder) throw new Error('search model changed');
    if (!this.db) await this.restore(embedder.id);
    return embedder;
  }

  get status() { return this.embedder?.status ?? 'idle'; }
  get embedderInfo() { return this.embedder; }

  /** Opens the model's database and reads which notes it has, moving an old JSON index in first. */
  private async restore(embedderId: string) {
    const db = openIndex(embedderId);
    this.db = db;
    const empty = !db.getFirstSync('SELECT 1 FROM notes LIMIT 1');
    if (empty) {
      const old = await kvGet<OldJson>(OLD_JSON_KEY + embedderId, cacheDir);
      if (old && this.db === db) {
        db.withTransactionSync(() => {
          for (const [path, e] of Object.entries(old)) {
            try {
              db.runSync('INSERT OR REPLACE INTO notes (path, hash) VALUES (?, ?)', path, e.hash);
              e.vecs.forEach((v, i) => db.runSync('INSERT OR REPLACE INTO chunks (path, i, text, vec) VALUES (?, ?, ?, ?)', path, i, e.chunks[i] ?? '', fromBase64(v)));
            } catch {
              // A damaged entry is simply embedded again.
            }
          }
        });
      }
    }
    void kvPrune('semantic.index.', '', cacheDir);
    if (this.db !== db) return;
    for (const r of db.getAllSync<{ path: string; hash: string }>('SELECT path, hash FROM notes')) this.hashes.set(r.path, r.hash);
    this.notify();
  }

  /** Writes one note's vectors (none for a note the model couldn't read). */
  private store(path: string, hash: string, chunks: string[], vecs: Float32Array[]) {
    const db = this.db;
    if (!db) return;
    db.withTransactionSync(() => {
      db.runSync('DELETE FROM chunks WHERE path = ?', path);
      vecs.forEach((v, i) => db.runSync('INSERT INTO chunks (path, i, text, vec) VALUES (?, ?, ?, ?)', path, i, chunks[i] ?? '', pack(v)));
      db.runSync('INSERT OR REPLACE INTO notes (path, hash) VALUES (?, ?)', path, hash);
    });
    this.hashes.set(path, hash);
    this.vectors?.set(path, vecs);
  }

  private remove(paths: string[]) {
    const db = this.db;
    if (!paths.length || !db) return;
    db.withTransactionSync(() => {
      for (const p of paths) {
        db.runSync('DELETE FROM chunks WHERE path = ?', p);
        db.runSync('DELETE FROM notes WHERE path = ?', p);
      }
    });
    for (const p of paths) { this.hashes.delete(p); this.vectors?.delete(p); }
  }

  /** Forgets every note not in `paths`. */
  retain(paths: string[]) {
    const keep = new Set(paths);
    const gone = [...this.hashes.keys()].filter((p) => !keep.has(p));
    if (gone.length) { this.remove(gone); this.notify(); }
  }

  /** Call with every note path whose text may have changed (or vanished). */
  schedule(paths: string[], source: NoteSource) {
    for (const p of paths) {
      const hash = source.hash(p);
      if (hash === undefined) { this.remove([p]); this.queue.delete(p); continue; }
      if (this.hashes.get(p) === hash) continue;
      this.queue.add(p);
    }
    this.notify();
    void this.drain(source);
  }

  private async drain(source: NoteSource) {
    const embedder = this.embedder;
    if (this.running || !embedder || embedder.status !== 'ready') return;
    this.running = true;
    let failed = 0;
    try {
      // Stops as soon as another model is picked; its vectors would not match.
      while (this.queue.size && this.embedder === embedder) {
        const path = this.queue.values().next().value as string;
        this.queue.delete(path);
        const text = await source.text(path);
        if (text === undefined) continue;
        const hash = hashText(text);
        let read: { chunks: string[]; vecs: Float32Array[] };
        try {
          read = await readChunks(embedder, chunkNote(text, embedder.chunkWords));
          failed = 0;
        } catch (e) {
          // One note the model can't read used to stop every note after it. It is kept without
          // vectors (tried again once its text changes) and the run goes on.
          if (++failed >= MAX_FAILED_NOTES) throw e;
          console.warn('semantic index skipped a note', path, e);
          read = { chunks: [], vecs: [] };
        }
        if (this.embedder !== embedder) break;
        // Each note is saved as it is done, so closing the app mid-run loses nothing.
        this.store(path, hash, read.chunks, read.vecs);
        this.notify();
      }
    } catch (e) {
      if (this.embedder === embedder) console.warn('semantic index failed', e);
    } finally {
      this.running = false;
      this.notify();
      // The new model's notes queued up while the old run was finishing.
      if (this.embedder !== embedder && this.queue.size) void this.drain(source);
    }
  }

  has(path: string) { return this.hashes.has(path); }

  /** Every vector, read from the database once; kept up to date by `store` and `remove` after that. */
  private allVectors(): Map<string, Float32Array[]> {
    if (this.vectors) return this.vectors;
    const out = new Map<string, Float32Array[]>();
    for (const r of this.db?.getAllSync<{ path: string; vec: Uint8Array }>('SELECT path, vec FROM chunks ORDER BY path, i') ?? []) {
      const list = out.get(r.path);
      if (list) list.push(unpack(r.vec)); else out.set(r.path, [unpack(r.vec)]);
    }
    this.vectors = out;
    return out;
  }

  async query(q: string, k = 30): Promise<SemanticHit[]> {
    const embedder = await this.ensureEmbedder();
    const [qv] = await embedder.embed([q], 'query');
    const best: { path: string; score: number; i: number }[] = [];
    for (const [path, vecs] of this.allVectors()) {
      let score = -1; let at = 0;
      for (let i = 0; i < vecs.length; i++) {
        const s = cosine(qv, vecs[i]);
        if (s > score) { score = s; at = i; }
      }
      if (score > -1) best.push({ path, score, i: at });
    }
    best.sort((a, b) => b.score - a.score);
    // Only the hits' chunk texts are read.
    return best.slice(0, k).map((h) => ({
      path: h.path,
      score: h.score,
      chunk: this.db?.getFirstSync<{ text: string }>('SELECT text FROM chunks WHERE path = ? AND i = ?', h.path, h.i)?.text ?? '',
    }));
  }
}

export const semanticIndex = new SemanticIndex();

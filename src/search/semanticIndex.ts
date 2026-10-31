import { cacheDir, kvGet, kvPrune, kvSet, moveIndexesToCache } from '@/utils/kv';
import { hashText } from '@/utils/markdown';
import { chunkNote } from './chunks';
import { cosine, getEmbedder, normalize, type Embedder } from './embedder';
import { DEFAULT_SEARCH_MODEL, searchModel, type SearchModelId } from './models';

/**
 * Note → vectors. Every note is split into chunks sized for the model (title
 * prepended to each so context is never lost). Vectors live in memory and are
 * persisted in the app's caches (`cacheDir`) keyed by content hash, so re-opening
 * the app never re-embeds unchanged notes. Brute-force cosine is plenty for
 * thousands of notes: 2000 notes × 3 chunks × 1024 dims ≈ 6M multiplies.
 */
interface Entry { hash: string; vecs: Float32Array[]; chunks: string[] }
type Saved = Record<string, { hash: string; chunks: string[]; vecs: string[] }>;

const INDEX_KEY = 'semantic.index.v2.';
/** How often a long run of embedding saves what it has. */
const SAVE_EVERY_MS = 20_000;
/** Notes in a row the model can't read before the run stops (the model itself is broken). */
const MAX_FAILED_NOTES = 5;

/**
 * Vectors are saved as int8 plus one scale each, base64: a tenth of the size of JSON
 * numbers, so the whole index stays a few MB and saves quickly. Cosine barely moves.
 */
function pack(v: Float32Array): string {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
  const scale = max / 127 || 1;
  const bytes = new Uint8Array(v.length + 4);
  new DataView(bytes.buffer).setFloat32(0, scale, true);
  for (let i = 0; i < v.length; i++) bytes[4 + i] = Math.round(v[i] / scale) & 0xff;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return btoa(bin);
}

function unpack(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const scale = new DataView(bytes.buffer).getFloat32(0, true);
  const out = new Float32Array(bytes.length - 4);
  for (let i = 0; i < out.length; i++) out[i] = ((bytes[4 + i] << 24) >> 24) * scale;
  return normalize(out);
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

export class SemanticIndex {
  private entries = new Map<string, Entry>();
  private embedder: Embedder | null = null;
  private queue = new Set<string>();
  private running = false;
  private listeners = new Set<Listener>();
  pending = 0;
  indexed = 0;
  private storageKey = INDEX_KEY;
  private loaded = false;
  private model: SearchModelId = DEFAULT_SEARCH_MODEL;
  private creating: Promise<Embedder> | null = null;

  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private notify() { this.pending = this.queue.size; this.indexed = this.entries.size; this.listeners.forEach((l) => l()); }

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
    this.entries.clear();
    this.queue.clear();
    this.loaded = false;
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
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
    this.storageKey = INDEX_KEY + embedder.id;
    if (!this.loaded) await this.restore();
    return embedder;
  }

  get status() { return this.embedder?.status ?? 'idle'; }
  get embedderInfo() { return this.embedder; }

  private async restore() {
    this.loaded = true;
    // Indexes of earlier models or formats are never read again.
    moveIndexesToCache();
    void kvPrune('semantic.index.', this.storageKey, cacheDir);
    const saved = await kvGet<Saved>(this.storageKey, cacheDir);
    if (!saved) return;
    for (const [path, e] of Object.entries(saved)) {
      try {
        this.entries.set(path, { hash: e.hash, chunks: e.chunks, vecs: e.vecs.map(unpack) });
      } catch {
        // A damaged entry is simply embedded again.
      }
    }
    this.notify();
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.save(), 8000);
  }

  private save() {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    const out: Saved = {};
    for (const [path, e] of this.entries) out[path] = { hash: e.hash, chunks: e.chunks, vecs: e.vecs.map(pack) };
    void kvSet(this.storageKey, out, cacheDir);
  }

  /** Forgets every note not in `paths`. */
  retain(paths: string[]) {
    const keep = new Set(paths);
    let dropped = false;
    for (const p of [...this.entries.keys()]) if (!keep.has(p)) { this.entries.delete(p); dropped = true; }
    if (dropped) { this.persist(); this.notify(); }
  }

  /** Call with every note path whose text may have changed (or vanished). */
  schedule(paths: string[], source: NoteSource) {
    for (const p of paths) {
      const hash = source.hash(p);
      if (hash === undefined) { if (this.entries.delete(p)) this.persist(); continue; }
      const e = this.entries.get(p);
      if (e && e.hash === hash) continue;
      this.queue.add(p);
    }
    this.notify();
    void this.drain(source);
  }

  private async drain(source: NoteSource) {
    const embedder = this.embedder;
    if (this.running || !embedder || embedder.status !== 'ready') return;
    this.running = true;
    let savedAt = Date.now();
    let failed = 0;
    try {
      // Stops as soon as another model is picked; its vectors would not match.
      while (this.queue.size && this.embedder === embedder) {
        const path = this.queue.values().next().value as string;
        this.queue.delete(path);
        const text = await source.text(path);
        if (text === undefined) continue;
        const hash = hashText(text);
        let entry: Entry;
        try {
          entry = { hash, ...(await readChunks(embedder, chunkNote(text, embedder.chunkWords))) };
          failed = 0;
        } catch (e) {
          // One note the model can't read used to stop every note after it. It is kept without
          // vectors (tried again once its text changes) and the run goes on.
          if (++failed >= MAX_FAILED_NOTES) throw e;
          console.warn('semantic index skipped a note', path, e);
          entry = { hash, chunks: [], vecs: [] };
        }
        if (this.embedder !== embedder) break;
        this.entries.set(path, entry);
        this.notify();
        // A long first run is saved as it goes; saved only at the end, closing the app started it over.
        if (Date.now() - savedAt > SAVE_EVERY_MS) { this.save(); savedAt = Date.now(); }
      }
      if (this.embedder === embedder) this.persist();
    } catch (e) {
      if (this.embedder === embedder) console.warn('semantic index failed', e);
    } finally {
      this.running = false;
      this.notify();
      // The new model's notes queued up while the old run was finishing.
      if (this.embedder !== embedder && this.queue.size) void this.drain(source);
    }
  }

  has(path: string) { return this.entries.has(path); }

  async query(q: string, k = 30): Promise<SemanticHit[]> {
    const embedder = await this.ensureEmbedder();
    const [qv] = await embedder.embed([q], 'query');
    const hits: SemanticHit[] = [];
    for (const [path, e] of this.entries) {
      let best = -1; let bestIdx = 0;
      for (let i = 0; i < e.vecs.length; i++) {
        const s = cosine(qv, e.vecs[i]);
        if (s > best) { best = s; bestIdx = i; }
      }
      if (best > -1) hits.push({ path, score: best, chunk: e.chunks[bestIdx] ?? '' });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}

export const semanticIndex = new SemanticIndex();

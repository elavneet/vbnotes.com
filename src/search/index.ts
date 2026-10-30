import { sectionOf, type Section } from '@/store/notes';
import type { NoteDb } from '@/store/noteDb';
import { semanticIndex } from './semanticIndex';

export { semanticIndex } from './semanticIndex';
export { getEmbedder } from './embedder';

export interface SearchResult {
  path: string;
  score: number;
  snippet: string;
  via: 'keyword' | 'smart' | 'both';
}

/** Meaning-only matches shown at most; the list is about the closest few. */
const MAX_SMART = 10;

/**
 * Hybrid search over one section. Keyword results (the index's full-text search) come back
 * instantly; semantic results are merged with reciprocal rank fusion when the model is ready.
 * Smart-only hits are kept so "notes about feeling stuck" still finds a note that never uses those words.
 */
export async function search(q: string, db: NoteDb, section: Section, smart: boolean): Promise<SearchResult[]> {
  const kw = db.search(q, section, 50).map((h, i, all) => ({ path: h.note.path, score: all.length - i, snippet: h.snippet }));
  if (!smart || semanticIndex.status !== 'ready') {
    return kw.map((h) => ({ ...h, via: 'keyword' as const }));
  }
  // The model's own noise level, and a window under the best hit wide enough for paraphrases.
  // (A fixed 0.3 floor used to drop most right answers: short questions score 0.15–0.3.)
  const ranked = (await semanticIndex.query(q, 40)).filter((h) => sectionOf(h.path) === section);
  const floor = Math.max(semanticIndex.embedderInfo?.minScore ?? 0.12, (ranked[0]?.score ?? 0) - 0.25);
  const sem = ranked.filter((h) => h.score >= floor).slice(0, MAX_SMART);
  const K = 60;
  const fused = new Map<string, SearchResult>();
  kw.forEach((h, i) => fused.set(h.path, { path: h.path, score: 1 / (K + i), snippet: h.snippet, via: 'keyword' }));
  sem.forEach((h, i) => {
    const prev = fused.get(h.path);
    if (prev) { prev.score += 1 / (K + i); prev.via = 'both'; }
    else fused.set(h.path, { path: h.path, score: 1 / (K + i), snippet: h.chunk.split('\n').slice(1).join(' ').slice(0, 120) || h.chunk.slice(0, 120), via: 'smart' });
  });
  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, 50);
}

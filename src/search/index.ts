import { sectionOf, type Section } from '@/store/notes';
import type { NoteDb } from '@/store/noteDb';
import { fuse, type SearchResult } from './fuse';
import { semanticIndex } from './semanticIndex';

export { semanticIndex } from './semanticIndex';
export { getEmbedder } from './embedder';
export type { SearchResult } from './fuse';

/**
 * Hybrid search over one section. Keyword results (the index's full-text search) come back
 * instantly; meaning results are merged in (`fuse`) when the model is ready.
 */
export async function search(q: string, db: NoteDb, section: Section, smart: boolean): Promise<SearchResult[]> {
  const kw = db.search(q, section, 50).map((h) => ({ path: h.note.path, snippet: h.snippet }));
  if (!smart || semanticIndex.status !== 'ready') {
    return kw.map((h, i, all) => ({ ...h, score: all.length - i, via: 'keyword' as const }));
  }
  const ranked = (await semanticIndex.query(q, 40)).filter((h) => sectionOf(h.path) === section);
  return fuse(kw, ranked, semanticIndex.embedderInfo?.minScore ?? 0.12);
}

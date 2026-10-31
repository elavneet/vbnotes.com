// Plain TypeScript, shared with the desktop app.

export interface SearchResult {
  path: string;
  score: number;
  snippet: string;
  via: 'keyword' | 'smart' | 'both';
}

/** A note's closest chunk to the question, with its cosine score. */
export interface MeaningMatch { path: string; score: number; chunk: string }

/** Meaning-only matches shown at most; the list is about the closest few. */
const MAX_SMART = 10;

/**
 * Keyword matches (best first) and meaning matches in one list, by reciprocal rank fusion.
 * Meaning matches count from the model's own noise level and within 0.25 of the best one, wide
 * enough for paraphrases (a fixed 0.3 floor used to drop most right answers: short questions
 * score 0.15–0.3). Meaning-only matches stay, so "notes about feeling stuck" still finds a note
 * that never uses those words.
 */
export function fuse(kw: { path: string; snippet: string }[], ranked: MeaningMatch[], minScore: number): SearchResult[] {
  const floor = Math.max(minScore, (ranked[0]?.score ?? 0) - 0.25);
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

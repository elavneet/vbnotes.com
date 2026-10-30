import type { SearchModel } from './models';

export type EmbedderStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

/** Search models read a question and a note differently (`query: ` / `document: ` prompts). */
export type EmbedKind = 'query' | 'document';

export interface Embedder {
  id: string;
  dim: number;
  status: EmbedderStatus;
  progress: number;
  error?: string;
  /** The model download stopped part way (the app was left); loading again continues it. */
  paused?: boolean;
  /** Why the embedder cannot run here (e.g. Expo Go). */
  reason?: string;
  /** Words per chunk, so a chunk fits the model's input. */
  chunkWords: number;
  /** Cosine score under which a match is noise for this model. */
  minScore: number;
  load(onProgress?: (p: number) => void): Promise<void>;
  embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]>;
  /** Frees the model's memory once another model takes over. */
  dispose(): void;
}

export async function getEmbedder(model: SearchModel): Promise<Embedder> {
  const { NativeEmbedder } = await import('./nativeEmbedder');
  return new NativeEmbedder(model);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are L2-normalised
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/**
 * The search models VBNotes can use, all shipped by react-native-executorch and run on the
 * phone. Scores are cosine similarities; `minScore` is where unrelated notes stop.
 */
export type SearchModelId = 'standard' | 'light' | 'languages';

export interface SearchModel {
  id: SearchModelId;
  /** The library's constant under `models.textEmbeddings`. */
  key: string;
  /** Stable id: the saved index is keyed by it. */
  embedderId: string;
  name: string;
  detail: string;
  dim: number;
  /** Words per chunk, so a chunk fits the model's input. */
  chunkWords: number;
  minScore: number;
  /** Search models read a question and a note differently. */
  prompts?: { query: string; document: string };
  /** Download size on an iPhone, used until the real size is fetched. */
  approxMB: number;
}

export const SEARCH_MODELS: SearchModel[] = [
  {
    // On 18 reworded questions it put the right note first 17 times (MiniLM: 16), and kept
    // unrelated notes under 0.15 where MiniLM let them reach 0.21.
    id: 'standard',
    key: 'LFM2_5_EMBEDDING_350M',
    embedderId: 'native:lfm2.5-embedding-350m',
    name: 'Standard',
    detail: 'Best results. English and 10 other languages.',
    dim: 1024,
    chunkWords: 200,
    minScore: 0.12,
    prompts: { query: 'query: ', document: 'document: ' },
    approxMB: 193,
  },
  {
    id: 'light',
    key: 'ALL_MINILM_L6_V2',
    embedderId: 'native:all-MiniLM-L6-v2',
    name: 'Light',
    detail: 'Small and quick. English only, finds less.',
    dim: 384,
    chunkWords: 120,
    minScore: 0.15,
    approxMB: 44,
  },
  {
    // Same test plus Hindi: right note first 19 of 22, and the only one that matched Hindi
    // notes to English questions (and back). Unrelated notes reach 0.25–0.45, so more noise.
    id: 'languages',
    key: 'PARAPHRASE_MULTILINGUAL_MINILM_L12_V2',
    embedderId: 'native:paraphrase-multilingual-MiniLM-L12-v2',
    name: 'Many languages',
    detail: '50+ languages, Hindi too, even across languages. Looser matches.',
    dim: 384,
    chunkWords: 120,
    minScore: 0.28,
    approxMB: 235,
  },
];

export const DEFAULT_SEARCH_MODEL: SearchModelId = 'standard';

export const searchModel = (id: SearchModelId | undefined) =>
  SEARCH_MODELS.find((m) => m.id === id) ?? SEARCH_MODELS.find((m) => m.id === DEFAULT_SEARCH_MODEL)!;

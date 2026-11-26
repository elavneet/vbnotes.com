/**
 * Voice typing's models at work: a recording goes through Parakeet (sherpa-onnx) a part at a time,
 * and what it heard through "S1-mini" by "Superwhisper" (llama.cpp). Parakeet holds about a
 * gigabyte, so it is let go as soon as it has heard the recording; the clean-up model is small and
 * stays for a few minutes (`loadTidy`).
 */
import { AppState } from 'react-native';
import { File } from 'expo-file-system';
import { cleanUp, cleanUpPrompt, mostTokens } from './cleanUp';
import { SPEECH, TIDY, modelDir } from './models';
import { RATE, cutAtPauses, to16k, wavSamples } from './sound';

// Loaded when first used: the Android app is built without these two packages.
const sherpa = async () => (await import('@siteed/sherpa-onnx.rn')).default;

let speech: Promise<void> | null = null;

/** Loads the speech model (a second or two); called when listening starts, so it is ready by the end. */
export function loadSpeech(): Promise<void> {
  speech ??= (async () => {
    const made = await (await sherpa()).ASR.initialize({
      modelDir: modelDir(SPEECH),
      // Parakeet is a NeMo transducer (patches/: the package took that name for a CTC model).
      modelType: 'nemo_transducer',
      streaming: false,
      numThreads: 2,
      decodingMethod: 'greedy_search',
      modelFiles: { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', joiner: 'joiner.int8.onnx', tokens: 'tokens.txt' },
    });
    if (!made.success) throw new Error(made.error ?? 'the speech model did not load');
  })().catch((e) => { speech = null; throw e; });
  return speech;
}

export async function releaseSpeech() {
  const was = speech;
  speech = null;
  if (!was) return;
  await was.catch(() => {});
  await (await sherpa()).ASR.release().catch(() => {});
}

/** What was said in the WAV file at `uri`, as Parakeet heard it. */
export async function hear(uri: string): Promise<string> {
  const { samples, rate } = wavSamples(await new File(uri).bytes());
  const heard: string[] = [];
  await loadSpeech();
  const { ASR } = await sherpa();
  for (const part of cutAtPauses(to16k(samples, rate))) {
    const result = await ASR.recognizeFromSamples(RATE, Array.from(part));
    if (!result.success) throw new Error(result.error ?? 'the speech could not be made out');
    const said = (result.text ?? '').trim();
    if (said) heard.push(said);
  }
  return heard.join(' ');
}

type Cleaner = Awaited<ReturnType<typeof import('llama.rn').initLlama>>;

let cleaner: Promise<Cleaner> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
/** The clean-up model stays loaded this long after it was last wanted. */
const KEEP_MS = 3 * 60_000;
/** A clean-up that takes longer than this is given up: what was heard is typed. */
const MOST_MS = 25_000;

/**
 * Loads the clean-up model and keeps it for the next few minutes; called when listening starts, so
 * it is ready when the talking stops. Loading it afresh for every use took far longer than the
 * clean-up itself. On the CPU: the model is small, its file stays mapped (iOS can take those pages
 * back when memory is short), and starting llama.cpp's Metal side took seconds each time.
 */
export function loadTidy(): Promise<Cleaner> {
  clearTimeout(idle);
  idle = setTimeout(() => void releaseTidy(), KEEP_MS);
  cleaner ??= (async () => {
    const { initLlama } = await import('llama.rn');
    return initLlama({ model: `${modelDir(TIDY)}/${TIDY.files[0].name}`, n_ctx: 2048, n_gpu_layers: 0 });
  })().catch((e) => { cleaner = null; throw e; });
  return cleaner;
}

export async function releaseTidy() {
  clearTimeout(idle);
  const was = cleaner;
  cleaner = null;
  if (!was) return;
  await was.then((context) => context.release()).catch(() => {});
}

// Nothing is kept while the app is away.
AppState.addEventListener('change', (state) => { if (state === 'background') void releaseTidy(); });

/** `said` as written text. Where the model fails or takes too long, the caller keeps what was heard. */
export async function tidy(said: string): Promise<string> {
  let late: ReturnType<typeof setTimeout> | undefined;
  let gaveUp = false;
  const loading = loadTidy();
  const work = (async () => {
    const context = await loading;
    return cleanUp(said, async (piece) => {
      if (gaveUp) throw new Error('the clean-up took too long');
      // Greedy, as the model was trained.
      const result = await context.completion({ prompt: cleanUpPrompt(piece), n_predict: mostTokens(piece), temperature: 0, top_k: 1, stop: ['<|im_end|>'] });
      return result.text;
    });
  })();
  const tooLong = new Promise<never>((_, reject) => {
    late = setTimeout(() => {
      gaveUp = true;
      void loading.then((context) => context.stopCompletion()).catch(() => {});
      reject(new Error('the clean-up took too long'));
    }, MOST_MS);
  });
  try {
    return await Promise.race([work, tooLong]);
  } finally {
    clearTimeout(late);
    work.catch(() => {});
  }
}

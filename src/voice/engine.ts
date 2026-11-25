/**
 * Voice typing's models at work: a recording goes through Parakeet (sherpa-onnx) a part at a time,
 * and what it heard through "S1-mini" by "Superwhisper" (llama.cpp). Only one model is in memory at
 * a time: Parakeet holds about a gigabyte, so it is let go before the clean-up model is loaded.
 */
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

/** `said` as written text. Where the model fails, what was heard is kept. */
export async function tidy(said: string): Promise<string> {
  const { initLlama } = await import('llama.rn');
  const context = await initLlama({ model: `${modelDir(TIDY)}/${TIDY.files[0].name}`, n_ctx: 2048, n_gpu_layers: 99 });
  try {
    return await cleanUp(said, async (piece) => {
      // Greedy, as the model was trained.
      const result = await context.completion({ prompt: cleanUpPrompt(piece), n_predict: mostTokens(piece), temperature: 0, top_k: 1, stop: ['<|im_end|>'] });
      return result.text;
    });
  } finally {
    await context.release().catch(() => {});
  }
}

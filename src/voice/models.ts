/**
 * Voice typing's two models, downloaded once into the app's documents (hidden, out of backups):
 * NVIDIA's Parakeet TDT 0.6B v3 turns speech into text, and "S1-mini" by "Superwhisper" cleans it
 * up. The same models as the desktop app's, each file checked against its sha256. Links go through
 * `https://api.vbnotes.com/models/…` (our copy), then to where the model is published.
 */
import { create } from 'zustand';
import { Directory, File, Paths } from 'expo-file-system';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { FolderAccess } from '@/vault/folderAccess';

type ModelFile = { name: string; size: number; sha256: string };
type Model = { dir: string; urls: string[]; files: ModelFile[] };

/** csukuangfj's sherpa-onnx export of `nvidia/parakeet-tdt-0.6b-v3` (CC BY 4.0), int8, at a fixed revision. */
export const SPEECH: Model = {
  dir: 'parakeet-tdt-0.6b-v3-int8',
  urls: [
    'https://api.vbnotes.com/models/parakeet-tdt-0.6b-v3-sherpa-ed5d7456',
    'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/ed5d745623472f97cfc2e6c2916ee248798fc5a8',
  ],
  // The big one last.
  files: [
    { name: 'tokens.txt', size: 93_939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
    { name: 'joiner.int8.onnx', size: 6_355_277, sha256: 'cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98' },
    { name: 'decoder.int8.onnx', size: 11_845_274, sha256: '0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5' },
    { name: 'encoder.int8.onnx', size: 652_282_294, sha256: '1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479' },
  ],
};

/** The Q4_K_M build of "S1-mini" by "Superwhisper" (its licence keeps that name wherever it is used). */
export const TIDY: Model = {
  dir: 's1-mini',
  urls: [
    'https://api.vbnotes.com/models/s1-mini-34add00a',
    'https://huggingface.co/superwhisper/s1-mini-GGUF/resolve/34add00a48a2e5d24e5a4ee5405a99620a3a240c',
  ],
  files: [{ name: 's1-mini-q4_k_m.gguf', size: 484_219_808, sha256: '3b41ebe2502cbd03e811d5d16b022f5ab551eda58d62597d152f89535003c634' }],
};

const sizeOf = (m: Model) => m.files.reduce((n, f) => n + f.size, 0);
export const SPEECH_SIZE = sizeOf(SPEECH);
export const TIDY_SIZE = sizeOf(TIDY);
export const sizeText = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

function root(): Directory {
  const dir = new Directory(Paths.document, '.vbnotes-voice');
  if (!dir.exists) {
    dir.create({ intermediates: true });
    // Models can be downloaded again: they stay out of iCloud backups (Apple's storage rules).
    try { FolderAccess?.keepOutOfBackup?.(dir.uri); } catch {}
  }
  return dir;
}

/** The folder of a model's files, as a plain path. */
export function modelDir(m: Model): string {
  return decodeURIComponent(new Directory(root(), m.dir).uri.replace(/^file:\/\//, '')).replace(/\/$/, '');
}

/** Every file is there at its full size (each was checked when it was downloaded). */
export function modelThere(m: Model): boolean {
  const dir = new Directory(root(), m.dir);
  return m.files.every((f) => { const file = new File(dir, f.name); return file.exists && file.size === f.size; });
}

type ModelState = 'missing' | 'downloading' | 'ready';
interface VoiceModels {
  speech: ModelState;
  tidy: ModelState;
  /** 0…1 over both models' bytes while they download. */
  progress: number;
  error: string | null;
}

export const useVoiceModels = create<VoiceModels>(() => ({
  speech: modelThere(SPEECH) ? 'ready' : 'missing',
  tidy: modelThere(TIDY) ? 'ready' : 'missing',
  progress: 0,
  error: null,
}));

async function fetchFile(m: Model, f: ModelFile, onBytes: (n: number) => void) {
  const dir = new Directory(root(), m.dir);
  if (!dir.exists) dir.create({ intermediates: true });
  const to = new File(dir, f.name);
  if (to.exists && to.size === f.size) { onBytes(f.size); return; }
  const part = `${modelDir(m)}/${f.name}.part`;
  let failure = 'no link answered';
  for (const base of m.urls) {
    try {
      const res = await ReactNativeBlobUtil.config({ path: part, overwrite: true })
        .fetch('GET', `${base}/${f.name}`)
        .progress({ interval: 300 }, (got) => onBytes(Number(got)));
      const status = res.info().status;
      if (status !== 200) throw new Error(`the server answered ${status}`);
      if ((await ReactNativeBlobUtil.fs.hash(part, 'sha256')) !== f.sha256) throw new Error('the file came through damaged');
      if (to.exists) to.delete();
      await ReactNativeBlobUtil.fs.mv(part, `${modelDir(m)}/${f.name}`);
      onBytes(f.size);
      return;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      await ReactNativeBlobUtil.fs.unlink(part).catch(() => {});
    }
  }
  throw new Error(failure);
}

let downloading: Promise<void> | null = null;
const KEEP_AWAKE = 'vbnotes-voice-download';

/** Downloads what is missing: the speech model, and the clean-up model if `tidy`. One download at a time. */
export function downloadVoiceModels(tidy: boolean): Promise<void> {
  downloading ??= (async () => {
    const wanted = [SPEECH, ...(tidy ? [TIDY] : [])].filter((m) => !modelThere(m));
    const total = wanted.reduce((n, m) => n + sizeOf(m), 0);
    let done = 0;
    useVoiceModels.setState({ error: null, progress: 0, ...(wanted.includes(SPEECH) && { speech: 'downloading' }), ...(wanted.includes(TIDY) && { tidy: 'downloading' }) });
    // The download stops when the app leaves the screen, so the screen stays on meanwhile.
    await activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
    try {
      for (const m of wanted) {
        for (const f of m.files) {
          await fetchFile(m, f, (n) => useVoiceModels.setState({ progress: total ? (done + n) / total : 1 }));
          done += f.size;
        }
        useVoiceModels.setState(m === SPEECH ? { speech: 'ready' } : { tidy: 'ready' });
      }
    } catch (e) {
      useVoiceModels.setState({ error: `The download stopped: ${e instanceof Error ? e.message : String(e)}. Try again.` });
    } finally {
      void deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
      useVoiceModels.setState({ speech: modelThere(SPEECH) ? 'ready' : 'missing', tidy: modelThere(TIDY) ? 'ready' : 'missing' });
      downloading = null;
    }
  })();
  return downloading;
}

/** Frees a model's space; using it again downloads it again. */
export function deleteVoiceModel(m: Model) {
  const dir = new Directory(root(), m.dir);
  if (dir.exists) dir.delete();
  useVoiceModels.setState(m === SPEECH ? { speech: 'missing' } : { tidy: 'missing' });
}

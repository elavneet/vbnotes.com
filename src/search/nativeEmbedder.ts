import { NativeModules, TurboModuleRegistry } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { normalize, type EmbedKind, type Embedder, type EmbedderStatus } from './embedder';
import { SEARCH_MODELS, type SearchModel } from './models';
import { FolderAccess } from '@/vault/folderAccess';

/** True when the ExecuTorch native code is linked into this binary (never in Expo Go). */
function nativeLinked(): boolean {
  try {
    return !!(TurboModuleRegistry.get('ETInstaller') || TurboModuleRegistry.get('ReactNativeBlobUtil') || NativeModules.ReactNativeBlobUtil);
  } catch {
    return false;
  }
}

const KEEP_AWAKE = 'vbnotes-model-download';

/**
 * On-device embedder for iOS/Android through React Native ExecuTorch, for one of the
 * models in `./models`. Needs a development build (not Expo Go) because it ships native code.
 */
export class NativeEmbedder implements Embedder {
  id: string;
  dim: number;
  chunkWords: number;
  minScore: number;
  status: EmbedderStatus = 'idle';
  progress = 0;
  error?: string;
  reason?: string;
  paused = false;
  private model: any = null;
  private loading: Promise<void> | null = null;
  private disposed = false;

  constructor(private spec: SearchModel) {
    this.id = spec.embedderId;
    this.dim = spec.dim;
    this.chunkWords = spec.chunkWords;
    this.minScore = spec.minScore;
  }

  private loadLib(): any | null {
    try {
      if (!nativeLinked()) throw new Error('native modules not linked');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lib = require('react-native-executorch');
      if (!lib?.createTextEmbedder) throw new Error('createTextEmbedder missing');
      // Notes never leave the phone; the library's download analytics need not either.
      lib.setTelemetryEnabled?.(false);
      return lib;
    } catch (e: any) {
      this.reason = 'Smart search needs the development build of VB Notes (not Expo Go).';
      this.status = 'unavailable';
      this.error = String(e?.message ?? e);
      return null;
    }
  }

  async load(onProgress?: (p: number) => void) {
    if (this.status === 'ready') return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const lib = this.loadLib();
      if (!lib) return;
      this.status = 'loading';
      this.paused = false;
      let downloaded = false;
      // The download runs in the app and stops a second after the app leaves the screen,
      // so the screen is kept on until it is done. (iOS background downloads were 4x slower.)
      void activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
      try {
        const resolved = await lib.download(lib.models.textEmbeddings[this.spec.key].DEFAULT, {
          onProgress: (p: number) => {
            this.progress = Math.round(p * 100);
            onProgress?.(this.progress);
          },
        });
        downloaded = true;
        void keepModelsOutOfBackup();
        const model = await lib.createTextEmbedder(resolved);
        // Switched to another model while this one downloaded.
        if (this.disposed) { model.dispose?.(); return; }
        this.model = model;
        this.status = 'ready';
        this.progress = 100;
        onProgress?.(100);
        void forgetOtherModels(lib, this.spec.key);
      } catch (e: any) {
        this.status = 'error';
        this.error = String(e?.message ?? e);
        // The bytes so far are kept: the next load continues from there.
        this.paused = !downloaded;
        // Let a later search try again (e.g. the download failed offline).
        this.loading = null;
        throw e;
      } finally {
        void deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
      }
    })();
    return this.loading;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
    if (!this.model) await this.load();
    if (!this.model) throw new Error(this.reason ?? 'Embedder unavailable');
    const out: Float32Array[] = [];
    const prompt = this.spec.prompts?.[kind];
    for (const t of texts) out.push(normalize(await this.model.embed(t, prompt)));
    return out;
  }

  dispose() {
    this.disposed = true;
    try { this.model?.dispose?.(); } catch { /* already gone */ }
    this.model = null;
    this.status = 'idle';
  }
}

/**
 * The library downloads models into Documents (so iOS never clears them), where iCloud would back
 * up 45–235 MB the app can fetch again and the Files app would show the folder. iOS only.
 */
async function keepModelsOutOfBackup() {
  try {
    if (!FolderAccess?.keepOutOfBackup) return;
    const { Directory, Paths } = await import('expo-file-system');
    FolderAccess.keepOutOfBackup(new Directory(Paths.document, 'react-native-executorch').uri);
  } catch (e) {
    console.warn('could not keep the search model out of backups', e);
  }
}

/** What switching to `spec` downloads, in MB: asked from the server, else the usual size. */
export async function downloadSizeMB(spec: SearchModel): Promise<number> {
  try {
    if (!nativeLinked()) return spec.approxMB;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('react-native-executorch').models.textEmbeddings[spec.key].DEFAULT;
    const head = (url: string) =>
      fetch(url, { method: 'HEAD' }).then((r) => Number(r.headers.get('content-length')) || 0);
    const timeout = new Promise<number[]>((resolve) => setTimeout(() => resolve([]), 4000));
    const sizes = await Promise.race([Promise.all([cfg.modelPath, cfg.tokenizerPath].map(head)), timeout]);
    const bytes = sizes.reduce((a, b) => a + b, 0);
    return sizes.length && sizes.every((b) => b > 0) ? Math.round(bytes / 1e6) : spec.approxMB;
  } catch {
    return spec.approxMB;
  }
}

/** Same cache names as the library's downloader (`<djb2 of url>_<file name>` in its folder). */
function cacheName(url: string) {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = (((h << 5) + h) ^ url.charCodeAt(i)) >>> 0;
  return `${h}_${url.split('/').pop()}`;
}

/** Frees the space of the search models not in use (45–235 MB each); switching back downloads again. */
async function forgetOtherModels(lib: any, keep: string) {
  try {
    const { Directory, File, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document, 'react-native-executorch');
    if (!dir.exists) return;
    for (const { key } of SEARCH_MODELS) {
      if (key === keep) continue;
      for (const variant of Object.values(lib.models.textEmbeddings[key] ?? {}) as { modelPath?: string; tokenizerPath?: string }[]) {
        for (const url of [variant.modelPath, variant.tokenizerPath]) {
          if (!url) continue;
          const f = new File(dir, cacheName(url.split('?')[0]));
          if (f.exists) f.delete();
        }
      }
    }
  } catch (e) {
    console.warn('could not remove old search model', e);
  }
}

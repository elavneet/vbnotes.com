import { Image } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getDocumentAsync } from 'expo-document-picker';
import { useNotes } from '@/store/notes';
import { dirname } from '@/vault/types';
import { attachmentName } from './attachmentName';

export { ATTACH_DIR } from './attachmentName';

/** Phone photos are 12+ MP; this keeps them sharp on screen without making notes slow to open. */
const MAX_EDGE = 2048;

function vault() {
  const v = useNotes.getState().vault;
  if (!v) throw new Error('No vault');
  return v;
}

/** Copies a file into `attachments/` and returns its link path. */
export async function saveFile(uri: string, ext: string): Promise<string> {
  const path = attachmentName(ext);
  await vault().importFile(uri, path);
  return path;
}

/** Shrinks a photo to MAX_EDGE, saves it as JPEG in `attachments/` and returns its link path. */
export async function saveImage(uri: string, width?: number, height?: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  if (width && height && Math.max(width, height) > MAX_EDGE) {
    ctx.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
  return saveFile(out.uri, 'jpg');
}

/**
 * A picture or sound pasted into a note (base64 from the editor page), saved in `attachments/`.
 * A JPEG (a photo) is shrunk like the camera's; a screenshot or other picture keeps its file.
 */
export async function savePasted(data: string, ext: string): Promise<string> {
  const tmp = new File(Paths.cache, `pasted-${Date.now()}.${ext}`);
  await tmp.write(data, { encoding: 'base64' });
  try {
    if (ext !== 'jpg') return await saveFile(tmp.uri, ext);
    const { width, height } = await Image.getSize(tmp.uri);
    return await saveImage(tmp.uri, width, height);
  } finally {
    tmp.delete();
  }
}

const PICTURES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic' };

/**
 * A picture the editor page couldn't load, mostly one iCloud hasn't brought to the phone yet (a
 * screenshot pasted on the Mac a minute ago is a `.name.png.icloud` stand-in): asks iCloud for the
 * files in its folder, waits up to two minutes for it to land and hands it over as a data URL, which
 * the page can show whatever it may read itself.
 */
export async function fetchMissing(src: string): Promise<string | null> {
  const v = useNotes.getState().vault;
  const rel = src.replace(/^\.?\//, '');
  const type = PICTURES[rel.split('.').pop()?.toLowerCase() ?? ''];
  if (!v || !type || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  const file = new File(v.baseUrl + rel);
  if (!file.exists) {
    let folder: string;
    try { folder = dirname(decodeURI(rel)); } catch { return null; }
    if (!(await v.fetchFromCloud?.(folder))) return null;
    for (let waited = 0; !file.exists; waited += 1000) {
      if (waited >= 120_000) return null;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return `data:${type};base64,${await file.base64()}`;
}

export async function pickPhotos(): Promise<string[]> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 1 });
  if (res.canceled) return [];
  const out: string[] = [];
  for (const a of res.assets) out.push(await saveImage(a.uri, a.width, a.height));
  return out;
}

/** Returns null when the camera is refused or closed. */
export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return saveImage(a.uri, a.width, a.height);
}

export async function pickAudioFile(): Promise<string | null> {
  const res = await getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;
  const ext = /\.([a-z0-9]+)$/i.exec(a.name)?.[1] ?? 'm4a';
  return saveFile(a.uri, ext);
}

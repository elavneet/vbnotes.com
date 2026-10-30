import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getDocumentAsync } from 'expo-document-picker';
import { useNotes } from '@/store/notes';

/**
 * Photos and recordings live next to the notes in `attachments/`, linked from the note as
 * `![](attachments/name.jpg)`: plain markdown that Obsidian and other editors show too.
 * Links are relative to the vault root, so they keep working when a note moves to Archive.
 */
export const ATTACH_DIR = 'attachments';

/** Phone photos are 12+ MP; this keeps them sharp on screen without making notes slow to open. */
const MAX_EDGE = 2048;

function newName(ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ATTACH_DIR}/${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rand}.${ext}`;
}

function vault() {
  const v = useNotes.getState().vault;
  if (!v) throw new Error('No vault');
  return v;
}

/** Copies a file into `attachments/` and returns its link path. */
export async function saveFile(uri: string, ext: string): Promise<string> {
  const path = newName(ext.replace(/^\./, '').toLowerCase());
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

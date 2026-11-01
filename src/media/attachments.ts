import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getDocumentAsync } from 'expo-document-picker';
import { useNotes } from '@/store/notes';
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

import { Directory, File, Paths } from 'expo-file-system';
import { marked } from 'marked';
import * as RN from 'react-native';
import { fileNameFromTitle, toPlainText } from './markdown';

/**
 * The phone's Copy As, Copy Link and Export in the ⋮ menu. The clipboard is React Native's
 * own (in every binary already, so this ships as an update); Export writes a copy of the note to
 * Caches and hands it to the share sheet: Save to Files, AirDrop, Mail.
 */
const clipboard = () => (RN as unknown as { Clipboard: { setString: (s: string) => void } }).Clipboard;

export type CopyFormat = 'md' | 'text' | 'html';

const htmlOf = (title: string, md: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title></head><body>${marked.parse(md, { async: false })}</body></html>`;

export function copyNote(md: string, format: CopyFormat) {
  clipboard().setString(format === 'md' ? md : format === 'text' ? toPlainText(md) : (marked.parse(md, { async: false }) as string));
}

/** `[[file name]]`, the same link the desktop's Copy Link makes. */
export function copyNoteLink(path: string) {
  clipboard().setString(`[[${(path.split('/').pop() ?? path).replace(/\.(md|markdown|txt)$/i, '')}]]`);
}

export async function exportNote(title: string, md: string, format: 'md' | 'html') {
  const name = `${fileNameFromTitle(title)}.${format}`;
  if (RN.Platform.OS !== 'ios') {
    // Android's share sheet takes text, not a file.
    await RN.Share.share({ title: name, message: format === 'md' ? md : htmlOf(title, md) });
    return;
  }
  const dir = new Directory(Paths.cache, 'export');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(format === 'md' ? md : htmlOf(title, md));
  await RN.Share.share({ url: file.uri, title: name });
}

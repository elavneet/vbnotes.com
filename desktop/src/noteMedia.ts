import type { Editor } from '@tiptap/core';
import { attachmentName } from '@/media/attachmentName';
import { insertMedia, pastedMedia } from '../../editor-web/mediaPaste';
import { api } from './api';

/** What a note shows from `![](…)`: pictures, and sound as a small player. */
export const MEDIA = /\.(png|jpe?g|gif|webp|heic|m4a|mp3|wav|aac)$/i;

/**
 * Pictures and sounds dropped on the open note from Finder or Explorer: copied into `attachments/`
 * and put where they were dropped, as the phone's picture button does.
 */
export async function dropMedia(editor: Editor, paths: string[], pos: number) {
  const added: string[] = [];
  for (const from of paths) {
    const to = attachmentName(from.split('.').pop() ?? '');
    await api.importFile(from, to);
    added.push(to);
  }
  if (added.length) insertMedia(editor, added, pos);
}

/** Pasted pictures and sounds are written into `attachments/` by the Rust side. */
export const PastedMedia = pastedMedia(async (file, ext) => {
  const to = attachmentName(ext);
  await api.saveFile(to, new Uint8Array(await file.arrayBuffer()));
  return to;
});

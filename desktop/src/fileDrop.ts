import { useEffect, useState, type RefObject } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { attachmentName } from '@/media/attachmentName';
import { UNTAGGED } from '@/store/noteModel';
import { fileNameFromTitle } from '@/utils/markdown';
import { formatTag } from '@/utils/tags';
import { RESERVED_FOLDERS, isMarkdown } from '@/vault/types';
import { openNote } from './actions';
import { api } from './api';
import { openEditor } from './NoteEditor';
import { uniquePath, useNotes } from './store';

/** What a note shows from `![](…)`: pictures, and sound as a small player. */
const MEDIA = /\.(png|jpe?g|gif|webp|heic|m4a|mp3|wav|aac)$/i;

const slashes = (p: string) => p.replace(/\\/g, '/');
const nameOf = (p: string) => slashes(p).split('/').filter(Boolean).pop() ?? '';
const stemOf = (name: string) => name.replace(/\.[^.]+$/, '');

/**
 * Files dropped on the notes list, as in Bear: a markdown or text file comes in as a note, a
 * picture or a sound gets a note of its own titled after the file, and a folder (an export from
 * another notes app) comes in whole with its notes and pictures. Nothing is ever overwritten.
 */
export async function addDropped(paths: string[]) {
  const { folder, tag } = useNotes.getState();
  if (!folder) return;
  await openEditor.flush();
  const kinds = await api.pathKinds(paths);
  const inFolder = `${slashes(folder).replace(/\/$/, '')}/`;
  const tagLine = tag && tag !== UNTAGGED ? `${formatTag(tag)}\n\n` : '';
  let last: string | null = null;
  for (const [i, from] of paths.entries()) {
    const name = nameOf(from);
    // Already in the notes folder (dragged from Finder's view of it): nothing to add.
    if (!name || slashes(from).startsWith(inFolder)) continue;
    if (kinds[i] === 'dir') {
      // A folder named Archive or Trash would become that section.
      const reserved = (Object.values(RESERVED_FOLDERS) as string[]).includes(name);
      await api.importFolder(from, await uniquePath('', reserved ? `${name} 2` : name, ''));
    } else if (kinds[i] === 'file' && isMarkdown(name)) {
      last = await uniquePath('', stemOf(name), name.slice(stemOf(name).length));
      await api.importFile(from, last);
    } else if (kinds[i] === 'file' && MEDIA.test(name)) {
      const media = attachmentName(name.split('.').pop() ?? '');
      await api.importFile(from, media);
      last = await uniquePath('', fileNameFromTitle(stemOf(name)));
      await api.writeFile(last, `# ${stemOf(name)}\n\n${tagLine}![](${media})\n`);
    }
  }
  await useNotes.getState().refresh();
  if (last) await openNote(last);
}

/** Whether files are being dragged over `target`; dropping them there adds them (`addDropped`). */
export function useFileDrop(target: RefObject<HTMLElement | null>) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    // The window reports physical pixels.
    const hit = ({ x, y }: { x: number; y: number }) => {
      const r = target.current?.getBoundingClientRect();
      const [cx, cy] = [x / devicePixelRatio, y / devicePixelRatio];
      return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    };
    const off = getCurrentWebview().onDragDropEvent(({ payload: e }) => {
      if (e.type === 'leave') return setOver(false);
      setOver(e.type !== 'drop' && hit(e.position));
      if (e.type === 'drop' && hit(e.position)) void addDropped(e.paths).catch((err) => console.warn('adding dropped files failed', err));
    });
    return () => { void off.then((f) => f()); };
  }, [target]);
  return over;
}

import { UNTAGGED, sectionOf } from '@/store/noteModel';
import { formatTag } from '@/utils/tags';
import { api } from './api';
import { openEditor } from './NoteEditor';
import { useNotes } from './store';

/**
 * A new note, titled when `title` is given (⌘O). One made while a tag is picked starts with that
 * tag under the title, as on the phone; a titled one ends in an empty line for the caret.
 */
export async function startNote(title = '') {
  await openEditor.flush();
  const { tag, createNote } = useNotes.getState();
  const tagLine = tag && tag !== UNTAGGED ? formatTag(tag) : '';
  await createNote(title ? `# ${title}\n\n${tagLine ? `${tagLine}\n\n` : ''}` : tagLine ? `# \n\n${tagLine} ` : '');
}

/** Opens a note picked outside the list; the list moves to its section if it isn't shown there. */
export async function openNote(path: string) {
  await openEditor.flush();
  const { section, tag, show, select } = useNotes.getState();
  const note = await api.get(path);
  const tags = note?.tags ?? [];
  const listed = sectionOf(path) === section
    && (!tag || (tag === UNTAGGED ? tags.length === 0 : tags.some((t) => t === tag || t.startsWith(`${tag}/`))));
  if (!listed) show(sectionOf(path));
  select(path);
}

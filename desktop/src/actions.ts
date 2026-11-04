import { BOOKMARKS, UNTAGGED, sectionOf, tagOf } from '@/store/noteModel';
import { formatTag } from '@/utils/tags';
import { api } from './api';
import { openEditor } from './NoteEditor';
import { useNotes } from './store';

/**
 * A new note, titled when `title` is given (⌘O). One made while a tag is picked starts with that
 * tag under the title, as on the phone, and one made in Bookmarks is bookmarked; a titled one ends
 * in an empty line for the caret.
 */
export async function startNote(title = '') {
  await openEditor.flush();
  const { tag, createNote, toggleBookmark } = useNotes.getState();
  const tagLine = tagOf(tag) ? formatTag(tag) : '';
  const path = await createNote(title ? `# ${title}\n\n${tagLine ? `${tagLine}\n\n` : ''}` : tagLine ? `# \n\n${tagLine} ` : '');
  if (tag === BOOKMARKS) await toggleBookmark(path);
}

/** Opens a note picked outside the list; the list moves to its section if it isn't shown there. */
export async function openNote(path: string) {
  await openEditor.flush();
  const { section, tag, bookmarks, show, select } = useNotes.getState();
  const note = await api.get(path);
  const tags = note?.tags ?? [];
  const listed = sectionOf(path) === section
    && (!tag || (tag === BOOKMARKS ? bookmarks.includes(path) : tag === UNTAGGED ? tags.length === 0 : tags.some((t) => t === tag || t.startsWith(`${tag}/`))));
  if (!listed) show(sectionOf(path));
  select(path);
}

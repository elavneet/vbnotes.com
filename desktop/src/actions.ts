import { BOOKMARKS, UNTAGGED, sectionOf, tagOf } from '@/store/noteModel';
import { formatTag } from '@/utils/tags';
import { api } from './api';
import { openEditor } from './NoteEditor';
import { useNotes } from './store';

/** A new note is being made (see `startNote`). */
let starting = false;

/**
 * A new note, titled when `title` is given (⌘O, a `[[link]]`). One made while a tag is picked starts
 * with that tag under the title, as on the phone, and one made in Bookmarks is bookmarked; a titled
 * one ends in an empty line for the caret. An untitled one (+, ⌘N) only opens the editor: its file
 * is made with the first text typed in it.
 */
export async function startNote(title = '') {
  // One note at a time: clicks or ⌘N that come while one is being made are dropped, or each made its own.
  if (starting) return;
  starting = true;
  try {
    await openEditor.flush();
    const { tag, createNote, openDraft, toggleBookmark } = useNotes.getState();
    const tagLine = tagOf(tag) ? formatTag(tag) : '';
    if (!title) {
      const open = useNotes.getState().selected;
      const path = await openDraft(tagLine ? `# \n\n${tagLine} ` : '', tag === BOOKMARKS);
      // + again on a new note that is still empty stays on it.
      if (path === open) openEditor.editor?.commands.focus();
      return;
    }
    const path = await createNote(`# ${title}\n\n${tagLine ? `${tagLine}\n\n` : ''}`);
    if (tag === BOOKMARKS) await toggleBookmark(path);
  } finally {
    starting = false;
  }
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

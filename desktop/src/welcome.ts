import { WELCOME_NOTE, WELCOME_PICTURE, WELCOME_TITLE, WELCOME_VERSION, welcomePlan } from '@/store/welcomeNote';
import { META_PATH, RESERVED_FOLDERS } from '@/vault/types';
import { api } from './api';
import { parseMeta, uniquePath, useNotes } from './store';

const WELCOMED_KEY = 'vbnotes.welcomed';

/** The phone's welcome note (`src/store/welcome.ts`), told for a computer: clicks and shortcuts instead of taps. */
function text() {
  const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  return `# Welcome to VB Notes

Your notes are plain **markdown files** in a folder you choose, so they stay yours: any app can open them. Try things out in this note, and delete it when you're done.

#vbnotes/welcome

## Write the way you like

- **Bold**, *italic*, ~~strike~~ and \`inline code\`
- Headings, quotes, numbered lists and tables
- Click **BIU** above the note for the style bar, or use Bear's shortcuts: ${mod}B, ${mod}I, ${mod}1 for a heading

> The first line of a note is its title, and the file is named after it.

## Checklists

- [x] Open VB Notes
- [ ] Tick this box
- [ ] Make a note with ${mod}N

## Tags instead of folders

Put a hash in front of a word anywhere in a note, like \`#ideas\`, and nest tags with a slash, like \`#work/clients\`. This note is tagged #vbnotes/welcome: find it in the sidebar on the left.

## Links between notes

Type two square brackets and the start of a title: a list of your notes comes up, and picking one writes a link like [[My first note]]. ${mod}-click a link to open its note. This one points to a note that doesn't exist yet, so opening it makes it.

## Pictures

![Mountains at dusk](attachments/welcome-mountains.png)

Add pictures from the style bar. They are saved next to your notes, in \`attachments\`.

## Diagrams

A code block marked \`mermaid\` becomes a drawing (click Edit to change it):

\`\`\`mermaid
flowchart LR
  P[Phone] -- iCloud Drive or a sync app --> F[(Your notes folder)]
  D[Mac or PC] -- same files --> F
\`\`\`

## Code

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
\`\`\`

## Tables

| To | Do this |
|---|---|
| Find a note | ${mod}O, or ${mod}F to search the list |
| Link to a note | Type [[ and pick one |
| Pin, archive or delete a note | Use the buttons above it |
| Change the look | Settings, ${mod}, |

## Search by meaning

Ask in your own words, like "that lentil recipe", and VB Notes finds notes by what they mean, not only by the words in them. The search model runs on this computer; your notes never leave it.

## Your notes everywhere

VB Notes for iPhone and Android opens the same folder. Keep it in iCloud Drive, or in a folder that Dropbox, Syncthing or another sync app keeps in step: https://vbnotes.com
`;
}

/**
 * The first launch, once the notes folder is chosen (an empty one or one that already has notes),
 * shows what the app does in one note, as on the phone. An older copy of it is replaced, its old
 * text moved to Trash; the current one is left as it is. Once per computer.
 */
export async function welcomeOnce() {
  const notes = useNotes.getState();
  if (!notes.folder) return;
  try {
    if (localStorage.getItem(WELCOMED_KEY)) return;
    localStorage.setItem(WELCOMED_KEY, '1');
  } catch {
    return;
  }
  const [entries, [metaText]] = await Promise.all([api.scan(), api.readFiles([META_PATH])]);
  const plan = welcomePlan(entries.find((e) => e.path === WELCOME_NOTE), parseMeta(metaText));
  if (plan === 'keep') return;
  if (plan === 'replace') await api.moveFile(WELCOME_NOTE, await uniquePath(RESERVED_FOLDERS.trash, WELCOME_TITLE));
  if (!(await api.exists(WELCOME_PICTURE))) {
    await api.welcomePicture(WELCOME_PICTURE).catch((e) => console.warn('welcome picture not copied', e)); // the note reads fine without it
  }
  await api.writeFile(WELCOME_NOTE, text());
  await notes.saveMeta({ welcome: WELCOME_VERSION });
  await notes.refresh();
  notes.select(WELCOME_NOTE);
}

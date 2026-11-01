import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { kvGetSync, kvSet } from '@/utils/kv';
import type { Vault, VaultMeta } from '@/vault/types';
import { WELCOME_NOTE, WELCOME_PICTURE, welcomePlan } from './welcomeNote';

const WELCOMED_KEY = 'welcomed';

/** What VB Notes does, shown by doing it: markdown, checklists, tags, a link, a picture, a diagram, code, a table. */
const TEXT = `# Welcome to VB Notes

Your notes are plain **markdown files** in a folder you choose, so they stay yours: any app can open them. Try things out in this note, and delete it when you're done.

#vbnotes/welcome

## Write the way you like

- **Bold**, *italic*, ~~strike~~ and \`inline code\`
- Headings, quotes, numbered lists and tables
- Tap **BIU** over the keyboard for the formatting keys

> The first line of a note is its title, and the file is named after it.

## Checklists

- [x] Open VB Notes
- [ ] Tick this box
- [ ] Make a note with the + button

## Tags instead of folders

Put a hash in front of a word anywhere in a note, like \`#ideas\`, and nest tags with a slash, like \`#work/clients\`. This note is tagged #vbnotes/welcome: tap ☰ at the bottom left to find it in the library. Hold a tag there to give it an icon.

## Links between notes

Type two square brackets and the start of a title: a list of your notes comes up, and picking one writes a link like [[My first note]]. Tap a link to open its note. This one points to a note that doesn't exist yet, so tapping it makes it.

## Pictures and voice notes

![Mountains at dusk](attachments/welcome-mountains.png)

Add photos and voice recordings from the bar over the keyboard. They are saved next to your notes, in \`attachments\`.

## Diagrams

A code block marked \`mermaid\` becomes a drawing (tap Edit to change it):

\`\`\`mermaid
flowchart LR
  P[Phone] -- ${Platform.OS === 'ios' ? 'iCloud Drive' : 'a sync app'} --> F[(Your notes folder)]
  D[Mac or PC] -- same files --> F
\`\`\`

## Code

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
\`\`\`

## Tables

| To | Do this |
|---|---|
| Find a note | Tap Search or ask |
| Link to a note | Type [[ and pick one |
| Pin or delete a note | Swipe it to the left |
| See a note's outline | Tap ⓘ in the note |

## Search by meaning

Ask in your own words, like "that lentil recipe", and VB Notes finds notes by what they mean, not only by the words in them. The search model runs on your phone; your notes never leave it.

## Your notes everywhere

${Platform.OS === 'ios'
  ? 'Keep your notes in iCloud Drive (**Settings › Notes folder › Use iCloud Drive**) and they stay in step on your iPhone and Mac.'
  : 'Keep your notes in a folder that a sync app such as Syncthing or FolderSync keeps in step (**Settings › Notes folder**), and open the same folder on your computer.'} The desktop app for Mac, Windows and Linux opens the same folder, and has a style bar with Bear's shortcuts: https://vbnotes.com
`;

/**
 * The first launch on this phone, once the notes folder is chosen (an empty one or one that already
 * has notes), shows what the app does in one note. An older copy of it is replaced, its old text
 * moved to Trash (`trashPath`); the current one is left as it is. Resolves with whether it wrote.
 */
export async function welcomeOnce(vault: Vault, meta: VaultMeta, trashPath: () => Promise<string>): Promise<boolean> {
  if (kvGetSync<boolean>(WELCOMED_KEY)) return false;
  await kvSet(WELCOMED_KEY, true);
  const plan = welcomePlan((await vault.list()).find((e) => e.path === WELCOME_NOTE && !e.isDir), meta);
  if (plan === 'keep') return false;
  if (plan === 'replace') await vault.move(WELCOME_NOTE, await trashPath());
  if (!(await vault.exists(WELCOME_PICTURE))) {
    try {
      const [picture] = await Asset.loadAsync(require('../../assets/welcome/mountains.png'));
      if (picture.localUri) await vault.importFile(picture.localUri, WELCOME_PICTURE);
    } catch (e) {
      console.warn('welcome picture not copied', e); // the note reads fine without it
    }
  }
  await vault.write(WELCOME_NOTE, TEXT);
  return true;
}

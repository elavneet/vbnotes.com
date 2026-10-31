import { Asset } from 'expo-asset';
import { kvGetSync, kvSet } from '@/utils/kv';
import type { Vault } from '@/vault/types';

const WELCOMED_KEY = 'welcomed';
const NOTE = 'Welcome to VB Notes.md';
const PICTURE = 'attachments/welcome-mountains.png';

/** What VB Notes does, shown by doing it: markdown, checklists, tags, a picture, a diagram, code, a table. */
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

## Pictures and voice notes

![Mountains at dusk](attachments/welcome-mountains.png)

Add photos and voice recordings from the bar over the keyboard. They are saved next to your notes, in \`attachments\`.

## Diagrams

A code block marked \`mermaid\` becomes a drawing (tap Edit to change it):

\`\`\`mermaid
flowchart LR
  P[Phone] -- iCloud Drive --> F[(Your notes folder)]
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
| Pin or delete a note | Swipe it to the left |
| See a note's outline | Tap ⓘ in the note |

## Search by meaning

Ask in your own words, like "that lentil recipe", and VB Notes finds notes by what they mean, not only by the words in them. The search model runs on your phone; your notes never leave it.

## Your notes everywhere

In **Settings › Notes folder**, pick a folder in iCloud Drive. The desktop app for Mac, Windows and Linux opens the same folder: https://github.com/elavneet/vbnotes.com/releases
`;

/**
 * The first launch, with an empty notes folder, gets one note that shows what the app does.
 * Once only: a deleted welcome note stays deleted, and people who already have notes never get it.
 */
export async function welcomeOnce(vault: Vault, notes: number): Promise<boolean> {
  if (kvGetSync<boolean>(WELCOMED_KEY)) return false;
  await kvSet(WELCOMED_KEY, true);
  if (notes > 0) return false;
  try {
    const [picture] = await Asset.loadAsync(require('../../assets/welcome/mountains.png'));
    if (picture.localUri) await vault.importFile(picture.localUri, PICTURE);
  } catch (e) {
    console.warn('welcome picture not copied', e); // the note reads fine without it
  }
  await vault.write(NOTE, TEXT);
  return true;
}

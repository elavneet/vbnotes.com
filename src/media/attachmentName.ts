/**
 * Photos and recordings live next to the notes in `attachments/`, linked from the note as
 * `![](attachments/name.jpg)`: plain markdown that Obsidian and other editors show too.
 * Links are relative to the vault root, so they keep working when a note moves to Archive.
 */
export const ATTACH_DIR = 'attachments';

/** `attachments/20261101-142233-k3x9.jpg`: when it was added, and a few letters so two never clash. */
export function attachmentName(ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ATTACH_DIR}/${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rand}.${ext.replace(/^\./, '').toLowerCase()}`;
}

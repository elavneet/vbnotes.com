import { firstImage, hashText, previewOf, splitTitle, toPlainText } from '@/utils/markdown';
import { extractTags } from '@/utils/tags';
import { RESERVED_FOLDERS, basename } from '@/vault/types';

/**
 * What the note list and the index know about a note, shared by the phone app (`notes.ts`,
 * `noteDb.ts`) and the desktop app (`desktop/`). Plain TypeScript, no React Native.
 */
export interface NoteMeta {
  path: string;
  title: string;
  preview: string;
  image: string | null;
  mtime: number;
  pinned: boolean;
  /** `#tags` found in the text, lowercased. */
  tags: string[];
}

export type Section = 'notes' | 'archive' | 'trash';

/** What the index keeps of one note file. */
export interface NoteRecord extends Omit<NoteMeta, 'pinned'> {
  section: Section;
  size: number;
  /** `hashText` of the file, so the meaning index can tell what changed without reading it. */
  hash: string;
  /** Plain text, for keyword search. */
  body: string;
}

/** Filter for notes without a single #tag. Not a valid tag itself, so it cannot clash. */
export const UNTAGGED = ':untagged';

export type SectionCounts = Record<Section | 'untagged', number>;

export interface TagNode {
  /** Full tag, e.g. `dev/code`. */
  path: string;
  name: string;
  children: TagNode[];
  count: number;
}

/** Names to hide from the Notes list: `#Melta`, ` melta/ ` and `melta` all name the tag `melta`; each once. */
export const cleanHiddenTags = (names: string[]) =>
  [...new Set(names.map((n) => n.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '').toLowerCase()).filter(Boolean))];

export function sectionOf(path: string): Section {
  const top = path.split('/')[0];
  if (top === RESERVED_FOLDERS.trash) return 'trash';
  if (top === RESERVED_FOLDERS.archive) return 'archive';
  return 'notes';
}

export function recordFrom(path: string, mtime: number, size: number, text: string): NoteRecord {
  const { title, body } = splitTitle(text);
  return {
    path,
    section: sectionOf(path),
    title: title || basename(path).replace(/\.(md|markdown|txt)$/i, ''),
    preview: previewOf(body),
    image: firstImage(text),
    mtime,
    size,
    tags: extractTags(text),
    hash: hashText(text),
    body: toPlainText(body),
  };
}

/** The tag tree from the index's counts (each note counted once per tag and per tag above it). */
export function buildTags(rows: { tag: string; n: number }[]): TagNode[] {
  const root: TagNode = { path: '', name: '', children: [], count: 0 };
  const byPath = new Map<string, TagNode>([['', root]]);
  const node = (path: string): TagNode => {
    let n = byPath.get(path);
    if (n) return n;
    const cut = path.lastIndexOf('/');
    const parent = node(cut === -1 ? '' : path.slice(0, cut));
    n = { path, name: path.slice(cut + 1), children: [], count: 0 };
    parent.children.push(n);
    byPath.set(path, n);
    return n;
  };
  for (const r of rows) node(r.tag).count = r.n;
  const sortRec = (n: TagNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sortRec); };
  sortRec(root);
  return root.children;
}

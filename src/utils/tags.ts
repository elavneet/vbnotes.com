/**
 * Bear-style tags inside plain markdown: `#tag`, `#nested/tag`, `#multi word tag#`.
 * Shared by the app (sidebar, filters) and the editor WebView (pill rendering),
 * so it must not import anything app-specific.
 */

const WORD = 'A-Za-z0-9_\\u00C0-\\uFFFF';
// A tag starts at the line start or after whitespace. Multi-word tags close with `#`.
const TAG_RE = new RegExp(
  `(^|\\s)#(?:([^\\s#][^#\\n]*?[^\\s#])#(?=$|\\s|[.,;:!?)])|([${WORD}][${WORD}\\-/]*))`,
  'g',
);
const HAS_LETTER = /[A-Za-zÀ-￿]/;

export interface TagMatch {
  /** Index of the leading `#`. */
  start: number;
  /** Index just past the tag (past the closing `#` for multi-word tags). */
  end: number;
  /** Like `end`, but past a trailing `/` or `-` too: `#work/` while a nested tag is being typed. */
  rawEnd: number;
  tag: string;
}

/** Finds tags in one run of text (a line or a paragraph). */
export function findTags(text: string): TagMatch[] {
  const out: TagMatch[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text))) {
    const start = m.index + m[1].length;
    if (m[2] !== undefined) {
      const tag = m[2].trim();
      const end = start + 1 + m[2].length + 1;
      if (HAS_LETTER.test(tag)) out.push({ start, end, rawEnd: end, tag });
      continue;
    }
    const raw = m[3];
    const tag = raw.replace(/[-/]+$/, '');
    if (!tag || !HAS_LETTER.test(tag)) continue;
    out.push({ start, end: start + 1 + tag.length, rawEnd: start + 1 + raw.length, tag });
    // Let a stripped trailing `/` or `-` be scanned again.
    TAG_RE.lastIndex = start + 1 + tag.length;
  }
  return out;
}

/** All distinct tags of a note, lowercased, skipping code blocks and inline code. */
export function extractTags(md: string): string[] {
  const seen = new Set<string>();
  let fence: string | null = null;
  for (const line of md.split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence || line.indexOf('#') === -1) continue;
    const clean = line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
    for (const t of findTags(clean)) seen.add(normalizeTag(t.tag));
  }
  return [...seen];
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/** Text to type for a tag: multi-word tags need the closing `#`. */
export function formatTag(tag: string): string {
  return /\s/.test(tag) ? `#${tag}#` : `#${tag}`;
}

/** Note has `tag` itself or a nested tag under it. */
export function hasTag(tags: readonly string[], tag: string): boolean {
  return tags.some((t) => t === tag || t.startsWith(tag + '/'));
}

/** Lines made only of tags (usually under the title); hidden from previews. */
export function isTagLine(line: string): boolean {
  const t = line.trim();
  if (!t || t[0] !== '#') return false;
  const found = findTags(t);
  if (!found.length) return false;
  let rest = t;
  for (let i = found.length - 1; i >= 0; i--) rest = rest.slice(0, found[i].start) + rest.slice(found[i].rawEnd);
  return rest.trim() === '';
}

/** Colour slot (0-7) for a tag. Nested tags share their root's colour, so #dev and #dev/code match. */
export function tagHue(tag: string): number {
  const root = normalizeTag(tag).split('/')[0];
  let h = 0;
  for (let i = 0; i < root.length; i++) h = (h * 31 + root.charCodeAt(i)) | 0;
  return Math.abs(h) % 8;
}

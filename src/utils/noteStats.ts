import { stripInline, toPlainText } from './markdown';

export type Heading = { level: number; text: string };

/** The ⓘ panel's counts: words, characters, paragraphs, read time. */
export function statsOf(md: string) {
  const plain = toPlainText(md).trim();
  const words = plain ? plain.split(/\s+/).length : 0;
  const paragraphs = md.split(/\n\s*\n/).filter((b) => b.trim()).length;
  const seconds = Math.round((words / 230) * 60);
  return {
    words,
    characters: plain.replace(/\n+/g, ' ').length,
    paragraphs,
    read: seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`,
  };
}

/** `#` headings outside code blocks, in order: the same ones the editor counts for `goToHeading`. */
export function headingsOf(md: string): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    const m = fence ? null : /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: stripInline(m[2]) });
  }
  return out;
}

/** "6 Nov 2026 at 4:47 PM". */
export function longDate(ms: number) {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** Whether `text` has a `[[link]]` to a note with this title or file path (Backlinks in the ⓘ panel). */
export function linksTo(text: string, title: string, path: string) {
  const file = (path.split('/').pop() ?? path).replace(/\.(md|markdown|txt)$/i, '');
  const names = [title, file].map((n) => n.trim().toLowerCase());
  for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) if (names.includes(m[1].trim().toLowerCase())) return true;
  return false;
}

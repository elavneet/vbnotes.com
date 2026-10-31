// Plain TypeScript, shared with the desktop app.
import { splitTitle, toPlainText } from '@/utils/markdown';

const MAX_CHUNKS = 16;

/** Code blocks and diagrams are noise for meaning; keyword search still finds them. */
const FENCED = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm;

/** A note split into chunks sized for the model, the title on each so its context is never lost. */
export function chunkNote(md: string, chunkWords = 120): string[] {
  const { title, body } = splitTitle(md);
  // `#work/dev` reads as "work/dev": the tag's words still say what the note is about.
  const text = toPlainText(body.replace(FENCED, '')).replace(/(^|\s)#(?=[^\s#])/g, '$1');
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  if (words.length === 0) return title ? [title] : [];
  const step = chunkWords - Math.round(chunkWords / 5);
  for (let i = 0; i < words.length && chunks.length < MAX_CHUNKS; i += step) {
    const piece = words.slice(i, i + chunkWords).join(' ');
    chunks.push(title ? `${title}\n${piece}` : piece);
  }
  return chunks;
}

/** What the chat sends with a question, the same on the phone and the desktop. */

export type Scope = 'note' | 'all';
export interface Source { path: string; title: string }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
/** `cost`: what the reply cost in dollars, where the provider says (OpenRouter). */
export interface Turn { role: 'user' | 'assistant'; content: string; id?: string; sources?: Source[]; error?: string; cost?: number }

/** What turning the chat on asks the person to agree to, on the phone and the desktop. */
export const CONSENT_TITLE = 'Turn on chat with AI?';
export const CONSENT_TEXT =
  'When you ask a question, VB Notes sends it to the AI provider you choose, with the note you are asking about or, when you ask about all notes, the notes that match it. The provider handles them under its own terms, with your own account. Nothing is sent until you ask, and you can turn this off at any time.';

/** What the model is told, ahead of the notes it may use. */
export const SYSTEM = `You are the assistant in VB Notes, a markdown notes app. Answer the person's questions using their notes, given below between <note> tags. Mention a note by its title when you use it. If the notes don't cover the question, say so, then help from general knowledge and make clear which part is which. Reply in markdown, and keep it short unless asked for more.`;

/**
 * How much goes with a question: one note in full up to NOTE_CHARS, or the parts of up to FOUND
 * notes that bear on it (`passages`), EACH_CHARS a note and ALL_CHARS in all. The model is paid by
 * what it reads, so all notes send about 3,000 words' worth at most.
 */
export const NOTE_CHARS = 60_000;
export const EACH_CHARS = 2_500;
export const ALL_CHARS = 10_000;
export const FOUND = 6;
/** The earlier messages that go with a question: the last three questions and their answers. */
const HISTORY = 6;

/** The conversation so far as it goes with the next question: the last HISTORY messages, a question first. */
export function historyOf(turns: Turn[]): ChatMessage[] {
  const kept = turns.filter((t) => !t.error && t.content).slice(-HISTORY);
  while (kept[0]?.role === 'assistant') kept.shift();
  return kept.map((t) => ({ role: t.role, content: t.content }));
}

export const noteBlock = (title: string, text: string, max: number) =>
  `<note title="${title.replace(/"/g, "'")}">\n${text.length > max ? `${text.slice(0, max)}\n[…the rest of this note is left out]` : text}\n</note>`;

/**
 * Whether a note has a tag that Hide from Notes names (Settings), at any level, as `notHidden` in
 * noteDb.ts: `melta` hides `#melta`, `#melta/x` and `#go2lister/melta`. Those notes stay out of
 * questions about all notes too.
 */
export function hiddenBy(tags: readonly string[], hidden: readonly string[]) {
  if (!hidden.length) return false;
  return tags.some((tag) => {
    const parts = tag.split('/');
    return parts.some((_, i) => {
      const p = parts.slice(0, i + 1).join('/');
      return hidden.some((h) => p === h || p.endsWith(`/${h}`));
    });
  });
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}\s/;
const ITEM = /^ ?([-*+]|\d+[.)])\s/;

/**
 * The parts of a note that bear on a question, within `max` characters. A note that fits goes
 * whole. A longer one sends its opening, then the paragraphs and list items holding most of the
 * question's words, in the note's own order and under their headings; left-out stretches show as
 * "…". A code block or diagram counts as one paragraph, and one too long for what is left is cut.
 * With none of the words (a match by meaning), the note's start.
 */
export function passages(text: string, query: string, max: number): string {
  if (text.length <= max) return text;
  const words = tellingWords(query);
  const blocks: { text: string; heading: string; score: number }[] = [];
  let heading = '';
  let lines: string[] = [];
  let fence = '';
  const has = (s: string) => {
    const tokens = s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return words.filter((w) => tokens.some((t) => t.startsWith(w))).length;
  };
  const flush = () => {
    const body = lines.join('\n').trim();
    lines = [];
    if (body) blocks.push({ text: body, heading, score: has(body) + has(heading) / 2 });
  };
  for (const line of text.split('\n')) {
    if (fence) {
      lines.push(line);
      if (line.trim().startsWith(fence)) { fence = ''; flush(); }
    } else if (FENCE.test(line)) {
      flush();
      fence = FENCE.exec(line)![1];
      lines.push(line);
    } else if (HEADING.test(line)) {
      flush();
      heading = line.trim();
    } else if (!line.trim()) {
      flush();
    } else {
      if (ITEM.test(line)) flush();
      lines.push(line);
    }
  }
  flush();
  if (!blocks.length) return text.slice(0, max);

  const keep = new Map<number, string>([[0, blocks[0].text.slice(0, 600)]]);
  let room = max - keep.get(0)!.length;
  const order = blocks.map((b, i) => i).filter((i) => i > 0 && blocks[i].score > 0).sort((a, b) => blocks[b].score - blocks[a].score || a - b);
  // Nothing matched by word: the note's start, block by block.
  for (const i of order.length ? order : blocks.map((_, i) => i).slice(1)) {
    const extra = blocks[i].heading.length + 8;
    const size = blocks[i].text.length + extra;
    if (size <= room) keep.set(i, blocks[i].text);
    else if (room - extra > 300) keep.set(i, `${blocks[i].text.slice(0, room - extra)}…`);
    else continue;
    room -= Math.min(size, room);
  }
  let out = '';
  let last = -1;
  let under = '';
  for (const i of [...keep.keys()].sort((a, b) => a - b)) {
    const b = blocks[i];
    if (last >= 0 && i > last + 1) out += '…\n\n';
    if (b.heading && b.heading !== under) out += `${b.heading}\n\n`;
    under = b.heading;
    out += `${keep.get(i)}\n\n`;
    last = i;
  }
  if (last < blocks.length - 1) out += '…';
  return out.trim();
}

/** Words that say nothing about which note is meant. */
const STOP = new Set('the and for are was were what when where which who whom how why this that these those with from about have has had did does done can could would should will shall you your yours mine our ours their there here they them then than tell show give please any all some note notes into onto over under out off not but just also very more most much many few one two'.split(' '));

/** The words of a question worth looking up one by one. */
export const tellingWords = (query: string) =>
  [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((w) => !STOP.has(w)).slice(0, 8);

/**
 * The notes that fit a question: the app's own search first (`found`). A question rarely has all
 * its words in one note, so when that finds little, each telling word is looked up on its own
 * (`byWord`); next to notes the search found, only ones with at least half the words count.
 * Notes of `hidden` tags (Hide from Notes) are left out.
 */
export async function relevantNotes<N extends { path: string; tags: string[] }>(query: string, all: N[], byWord: (word: string) => Promise<N[]>, hidden: readonly string[] = []): Promise<N[]> {
  const shown = (notes: N[]) => notes.filter((n) => !hiddenBy(n.tags, hidden));
  const found = shown(all);
  if (found.length >= 3) return found.slice(0, FOUND);
  const words = tellingWords(query);
  const score = new Map<string, { note: N; n: number }>();
  for (const w of words) {
    for (const note of shown(await byWord(w).catch(() => [] as N[]))) {
      const had = score.get(note.path);
      score.set(note.path, { note, n: (had?.n ?? 0) + 1 });
    }
  }
  const need = found.length ? Math.ceil(words.length / 2) : 1;
  const more = [...score.values()].filter((s) => s.n >= need).sort((a, b) => b.n - a.n).map((s) => s.note);
  const seen = new Set(found.map((n) => n.path));
  return [...found, ...more.filter((n) => !seen.has(n.path))].slice(0, FOUND);
}

/** The notes a reply names, when it names any; else every note that was sent. */
export function namedSources(turn: Turn): Source[] {
  const named = turn.sources?.filter((s) => turn.content.includes(s.title)) ?? [];
  return named.length ? named : turn.sources ?? [];
}

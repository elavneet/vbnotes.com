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

/** How much goes with a question: one note in full up to NOTE_CHARS, or up to FOUND notes within ALL_CHARS. */
export const NOTE_CHARS = 60_000;
export const EACH_CHARS = 8_000;
export const ALL_CHARS = 40_000;
export const FOUND = 8;

export const noteBlock = (title: string, text: string, max: number) =>
  `<note title="${title.replace(/"/g, "'")}">\n${text.length > max ? `${text.slice(0, max)}\n[…the rest of this note is left out]` : text}\n</note>`;

/** Words that say nothing about which note is meant. */
const STOP = new Set('the and for are was were what when where which who whom how why this that these those with from about have has had did does done can could would should will shall you your yours mine our ours their there here they them then than tell show give please any all some note notes into onto over under out off not but just also very more most much many few one two'.split(' '));

/** The words of a question worth looking up one by one. */
export const tellingWords = (query: string) =>
  [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((w) => !STOP.has(w)).slice(0, 8);

/**
 * The notes that fit a question: the app's own search first (`found`). A question rarely has all
 * its words in one note, so when that finds little, each telling word is looked up on its own
 * (`byWord`); next to notes the search found, only ones with at least half the words count.
 */
export async function relevantNotes<N extends { path: string }>(query: string, found: N[], byWord: (word: string) => Promise<N[]>): Promise<N[]> {
  if (found.length >= 3) return found.slice(0, FOUND);
  const words = tellingWords(query);
  const score = new Map<string, { note: N; n: number }>();
  for (const w of words) {
    for (const note of await byWord(w).catch(() => [] as N[])) {
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

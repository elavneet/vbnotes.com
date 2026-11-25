/**
 * Voice typing's clean-up, the parts that are plain text work: what was heard is cut into pieces
 * between sentences, each goes to "S1-mini" by "Superwhisper" with the prompt it was trained on,
 * and an answer that doesn't look like a clean-up of what was said (a reply, a translation, made-up
 * text) is dropped for what was heard. The same rules as the desktop's `tidy.rs`.
 */

/** The prompt, word for word as the model was trained on: changed, it can make things up. */
const SYSTEM = 'You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text.';
/** Standard written English with contractions kept, in sentences (never turned into a list). */
const CONTROL = '[Styling: semi-formal] [Structure: prose] [Context: general]';
/** Cleaned a piece at a time, each about this many words, cut between sentences. */
const PIECE_WORDS = 120;

export function cleanUpPrompt(said: string): string {
  return `<|im_start|>system\n${SYSTEM}<|im_end|>\n<|im_start|>user\n${CONTROL}\n${said}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

/** A clean-up is never much longer than what was said (about four letters a token). */
export function mostTokens(said: string): number {
  return Math.floor(said.length / 3) + 32;
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * A clean-up only takes words away and tidies the rest: nearly every word it writes was said, and
 * it is not much longer. Nothing left is right only when nothing but um and uh was said.
 */
export function fits(said: string, cleaned: string): boolean {
  const heard = words(said);
  const out = words(cleaned);
  const n = heard.length;
  if (!out.length) return n <= 3;
  if (out.length > n + Math.floor(n / 4) + 4) return false;
  const set = new Set(heard);
  return out.filter((w) => set.has(w)).length * 10 >= out.length * 7;
}

/** `said` in pieces of about `PIECE_WORDS` words, cut after a sentence's . ? or ! */
export function pieces(said: string): string[] {
  const out: string[] = [];
  let n = 0;
  for (const s of said.split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter(Boolean)) {
    const w = s.split(/\s+/).length;
    if (out.length && n + w <= PIECE_WORDS) {
      out[out.length - 1] += ` ${s}`;
      n += w;
    } else {
      out.push(s);
      n = w;
    }
  }
  return out;
}

/** `said` cleaned by `run` (one pass of the model), piece by piece; a piece that fails stays as heard. */
export async function cleanUp(said: string, run: (piece: string) => Promise<string>): Promise<string> {
  const out: string[] = [];
  for (const piece of pieces(said)) {
    let cleaned: string;
    try {
      // One line: it is typed into a paragraph.
      cleaned = (await run(piece)).split(/\s+/).filter(Boolean).join(' ');
    } catch {
      cleaned = piece;
    }
    out.push(fits(piece, cleaned) ? cleaned : piece);
  }
  return out.filter(Boolean).join(' ');
}

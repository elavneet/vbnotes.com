/**
 * The markdown for callouts, coloured highlights and folded headings. Plain TypeScript: the editor page, its stylesheet, the native
 * preview and the desktop's menus share it.
 */

/**
 * Highlighter colours: `==🟢text==`, with the plain `==text==` the default. The menus offer
 * these five; 🟠 and 🟤 are read too, and kept when a note has them.
 */
export const HIGHLIGHTS = [
  { color: 'green', emoji: '🟢', label: 'Green', rgb: '52, 199, 89' },
  { color: 'red', emoji: '🔴', label: 'Red', rgb: '255, 69, 58' },
  { color: 'blue', emoji: '🔵', label: 'Blue', rgb: '10, 132, 255' },
  { color: 'yellow', emoji: '🟡', label: 'Yellow', rgb: '255, 204, 0' },
  { color: 'purple', emoji: '🟣', label: 'Purple', rgb: '175, 82, 222' },
  { color: 'orange', emoji: '🟠', label: 'Orange', rgb: '255, 149, 0' },
  { color: 'brown', emoji: '🟤', label: 'Brown', rgb: '162, 132, 94' },
] as const;

export type HighlightColor = (typeof HIGHLIGHTS)[number]['color'];

/** The colours the highlighter menus list (after Default). */
export const MENU_HIGHLIGHTS = HIGHLIGHTS.slice(0, 5);

/** A highlight's colour name, or null for the default (anything else, such as an old hex, counts as default). */
export const highlightColor = (value: unknown): HighlightColor | null =>
  HIGHLIGHTS.find((h) => h.color === value)?.color ?? null;

export const highlightEmoji = (color: unknown) => HIGHLIGHTS.find((h) => h.color === color)?.emoji ?? '';

export const colorOfEmoji = (emoji: string | undefined): HighlightColor | null =>
  HIGHLIGHTS.find((h) => h.emoji === emoji)?.color ?? null;

/** The emoji alternatives, for regular expressions. */
export const HIGHLIGHT_EMOJI = HIGHLIGHTS.map((h) => h.emoji).join('|');

/**
 * Callouts, as GitHub writes them: a quote whose first line is `> [!NOTE]`, optionally followed by
 * a title. Icons are 24px stroke paths; colours are GitHub's, light and dark.
 */
export const CALLOUTS = [
  { type: 'note', label: 'Note', light: '#0969DA', dark: '#4493F8', icon: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8h.01' },
  { type: 'tip', label: 'Tip', light: '#1A7F37', dark: '#3FB950', icon: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z' },
  { type: 'important', label: 'Important', light: '#8250DF', dark: '#AB7DF8', icon: 'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 7.5v4M12 14h.01' },
  { type: 'warning', label: 'Warning', light: '#9A6700', dark: '#D29922', icon: 'M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.2h.01' },
  { type: 'caution', label: 'Caution', light: '#D1242F', dark: '#F85149', icon: 'M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2L8.2 3zM12 8v5M12 16h.01' },
] as const;

export type CalloutType = (typeof CALLOUTS)[number]['type'];

export const calloutOf = (type: unknown) => CALLOUTS.find((c) => c.type === type) ?? null;

/** `> [!NOTE] Optional title` at the start of a quote line. */
export const CALLOUT_HEAD = /^ {0,3}>[ \t]?\[!(note|tip|important|warning|caution)\][ \t]*([^\n]*)/i;

/**
 * A folded heading: the marker right after the heading's text,
 * `## Plans<!-- {"fold":"true"} -->`, so the fold travels with the note.
 */
export const FOLD_MARK = '<!-- {"fold":"true"} -->';
export const FOLD_COMMENT = /^<!--\s*\{\s*"fold"\s*:\s*"true"\s*\}\s*-->$/;
export const FOLD_AT_END = /[ \t]*<!--\s*\{\s*"fold"\s*:\s*"true"\s*\}\s*-->[ \t]*$/;

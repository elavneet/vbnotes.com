import { markInputRule, markPasteRule, type AnyExtension } from '@tiptap/core';
import type { BridgeExtension } from '@10play/tentap-editor';
import { HIGHLIGHT_EMOJI, colorOfEmoji, highlightColor, highlightEmoji } from '../src/editor/noteSyntax';
import { calloutQuote } from './callouts';
import { foldingHeading } from './folding';

// `~word~`: one tilde on each side, touching the text, and not part of a `~~strike~~`.
const UNDERLINE = /^~(?![~\s])([^~\n]*?[^~\s\\])~(?!~)|^\+\+([\s\S]+?)\+\+/;
// The same typed or pasted: `~word~` after a space or at a line start.
const TYPED = /(?:^|\s)(~([^~\s](?:[^~]*[^~\s])?)~)$/;
const PASTED = /(?:^|\s)(~([^~\s](?:[^~]*[^~\s])?)~)(?!~)/g;

/**
 * Underline written `~word~`. Tiptap wrote `++word++`, which other markdown apps show as plain
 * text, and read `~word~` as strikethrough (GFM allows one tilde), so the next save turned an
 * underline into `~~word~~`. `++word++` from older notes still reads as underline. Typing
 * `~word~` underlines it.
 */
function tildeUnderline(extension: AnyExtension) {
  return extension.extend({
    renderMarkdown: (node: any, h: any) => `~${h.renderChildren(node)}~`,
    addInputRules(this: { type: any }) { return [markInputRule({ find: TYPED, type: this.type })]; },
    addPasteRules(this: { type: any }) { return [markPasteRule({ find: PASTED, type: this.type })]; },
    markdownTokenizer: {
      name: 'underline',
      level: 'inline',
      start: (src: string) => {
        const a = src.indexOf('~');
        const b = src.indexOf('++');
        return a < 0 ? b : b < 0 ? a : Math.min(a, b);
      },
      tokenize: (src: string, _tokens: unknown, lexer: { inlineTokens: (s: string) => unknown[] }) => {
        const m = UNDERLINE.exec(src);
        if (!m) return undefined;
        const text = m[1] ?? m[2].trim();
        return { type: 'underline', raw: m[0], text, tokens: lexer.inlineTokens(text) };
      },
    },
  } as never);
}

// `==text==`, or `==🟢text==` in a colour.
const HIGHLIGHT = new RegExp(`^==(${HIGHLIGHT_EMOJI})?([^=]+)==`);

/**
 * Highlights in colours. The colour is a name (`green`…) drawn by the editor's stylesheet per
 * theme, written as a coloured circle emoji after the opening `==`; no colour is the default.
 */
function colourHighlight(extension: AnyExtension) {
  return extension.extend({
    addAttributes: () => ({
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => highlightColor(el.getAttribute('data-color')),
        renderHTML: (attrs: { color?: unknown }) => {
          const color = highlightColor(attrs.color);
          return color ? { 'data-color': color } : {};
        },
      },
    }),
    renderMarkdown: (node: any, h: any) => `==${highlightEmoji(node.attrs?.color)}${h.renderChildren(node)}==`,
    parseMarkdown: (token: any, h: any) => h.applyMark('highlight', h.parseInline(token.tokens || []), token.color ? { color: token.color } : undefined),
    markdownTokenizer: {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => src.indexOf('=='),
      tokenize: (src: string, _tokens: unknown, lexer: { inlineTokens: (s: string) => unknown[] }) => {
        const m = HIGHLIGHT.exec(src);
        if (!m) return undefined;
        const text = m[2].trim();
        return { type: 'highlight', raw: m[0], text, color: colorOfEmoji(m[1]), tokens: lexer.inlineTokens(text) };
      },
    },
  } as never);
}

const SYNTAX: Record<string, (extension: AnyExtension) => AnyExtension> = {
  underline: tildeUnderline,
  highlight: colourHighlight,
  heading: foldingHeading,
  blockquote: calloutQuote,
};

/**
 * Tentap's bridges with the notes' markdown: `~underline~`, `==🟢coloured highlights==`, headings that
 * stay folded (`<!-- {"fold":"true"} -->`) and `> [!NOTE]` callouts.
 */
export function withNoteSyntax(bridges: BridgeExtension[]): BridgeExtension[] {
  return bridges.map((bridge) => {
    const swap = SYNTAX[bridge.name];
    if (!swap || !bridge.tiptapExtension) return bridge;
    const copy = bridge.clone();
    copy.tiptapExtension = swap(bridge.tiptapExtension as AnyExtension);
    return copy;
  });
}

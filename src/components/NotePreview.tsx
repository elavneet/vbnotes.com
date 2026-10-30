import React, { memo, useMemo } from 'react';
import { Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { codeFont, textFont, weightIn, type EditorFont, type Theme, type Typography } from '@/theme';
import { findTags, tagHue } from '@/utils/tags';
import { highlightCode } from '@/editor/highlight';
import { EDITOR as E } from '@/editor/editorCss';
import { marked, type Token, type Tokens } from 'marked';

/**
 * A native drawing of the top of a note, laid out from the same `EDITOR` sizes
 * and margins as the editor CSS (`src/editor/editorCss.ts`). It shows during the
 * screen's slide-in while the editor WebView boots, then the editor fades in over it.
 */

type Marker = 'bullet' | 'number' | 'task';
type ListItem = {
  text: string;
  /** Kinds of the lists this item sits in, outermost first (its own list last). */
  lists: Marker[];
  marker: Marker;
  n?: number;
  checked?: boolean;
  /** Under a checked task: the editor greys and strikes the whole item. */
  muted?: boolean;
  /** Has a nested list right under it. */
  nested?: boolean;
  /** Last item of a nested list; `flex` when that list sits in a task item (no margin collapsing). */
  closesNested?: 'flex' | 'block';
};
type Block =
  | { k: 'h'; level: number; text: string }
  | { k: 'p'; text: string }
  | { k: 'empty' }
  | { k: 'tags'; rows: string[][] }
  | { k: 'list'; task: boolean; items: ListItem[] }
  | { k: 'quote'; text: string }
  | { k: 'code'; text: string; lang?: string }
  | { k: 'table'; header: string[]; rows: string[][]; align: ('left' | 'center' | 'right' | null)[] }
  | { k: 'hr' };

/** Only the first screens matter; cut long notes at a blank line. */
const MAX_CHARS = 6000;
const TRAILING_BLANK_LINES = /\n[^\S\n]*(?:\n[^\S\n]*)+$/;

/**
 * Same blank-line rule as @tiptap/markdown (MarkdownManager.parseTokens): blank lines
 * absorbed into a token's raw become `space` tokens, and every extra blank-line pair
 * between two blocks is an empty paragraph in the editor.
 */
function withBlankLines(tokens: Token[]): Token[] {
  return tokens.flatMap((tok, i) => {
    if (tok.type === 'space' || tokens[i + 1]?.type === 'space') return [tok];
    const m = (tok.raw || '').match(TRAILING_BLANK_LINES);
    if (!m) return [tok];
    return [{ ...tok, raw: tok.raw.slice(0, -m[0].length) } as Token, { type: 'space', raw: m[0] } as Token];
  });
}

function listItems(list: Tokens.List, outer: Marker[], muted: boolean, out: ListItem[]) {
  const kind: Marker = list.items.some((it) => it.task) ? 'task' : list.ordered ? 'number' : 'bullet';
  const lists = [...outer, kind];
  list.items.forEach((item, idx) => {
    const lead = item.tokens.find((x) => x.type === 'text' || x.type === 'paragraph') as Tokens.Text | undefined;
    const marker: Marker = kind === 'task' ? 'task' : kind;
    const self = out.length;
    out.push({
      text: (lead?.text ?? '').replace(kind === 'task' ? /^\s*\[[ xX]\]\s*/ : /^/, '').trim(), lists, marker, muted,
      n: list.ordered ? Number(list.start || 1) + idx : undefined,
      checked: kind === 'task' ? !!item.checked : undefined,
    });
    for (const sub of item.tokens) {
      if (sub.type !== 'list') continue;
      out[self].nested = true;
      listItems(sub as Tokens.List, lists, muted || !!(kind === 'task' && item.checked), out);
      out[out.length - 1].closesNested = kind === 'task' ? 'flex' : 'block';
    }
  });
}

function paragraph(text: string): Block {
  // The editor's bundled tiptap shows `&nbsp;` as text, so it is left as text here too.
  // The editor keeps single newlines inside a paragraph (pre-wrap), so they stay line breaks.
  const rows = text.split('\n').map((line) => {
    const tags = findTags(line);
    const rest = tags.reduceRight((acc, t) => acc.slice(0, t.start) + acc.slice(t.rawEnd), line).trim();
    return tags.length && !rest ? tags.map((t) => line.slice(t.start + 1, t.end)) : null;
  });
  return rows.every((r) => r) ? { k: 'tags', rows: rows as string[][] } : { k: 'p', text };
}

const isMedia = (tok: Token) =>
  (tok.type === 'code' && /^mermaid\b/i.test((tok as Tokens.Code).lang ?? '')) || /!\[[^\]]*\]\(/.test(tok.raw ?? '');

function parse(md: string): Block[] {
  let src = md.replace(/^\uFEFF/, '');
  if (src.length > MAX_CHARS) {
    const cut = src.indexOf('\n\n', MAX_CHARS);
    if (cut !== -1) src = src.slice(0, cut);
  }
  let tokens: Token[];
  try { tokens = withBlankLines(marked.lexer(src)); } catch { return [{ k: 'p', text: src.slice(0, 2000) }]; }
  // Diagrams, images and audio only exist in the editor: the preview stops above the first one
  // rather than draw something the editor then replaces with a different height.
  const media = tokens.findIndex(isMedia);
  if (media !== -1) tokens = tokens.slice(0, media);
  const solid = tokens.map((tok, i) => (tok.type === 'space' ? -1 : i)).filter((i) => i >= 0);
  const out: Block[] = [];
  tokens.forEach((tok, i) => {
    switch (tok.type) {
      case 'space': {
        const pairs = ((tok.raw || '').replace(/\r\n/g, '\n').match(/\n\n/g) || []).length;
        const between = solid.some((j) => j < i) && solid.some((j) => j > i);
        for (let n = Math.max(pairs - (between ? 1 : 0), 0); n > 0; n--) out.push({ k: 'empty' });
        return;
      }
      case 'heading': out.push({ k: 'h', level: (tok as Tokens.Heading).depth, text: (tok as Tokens.Heading).text }); return;
      case 'paragraph':
      case 'text':
      case 'html': out.push(paragraph(((tok as Tokens.Paragraph).text ?? tok.raw).replace(/\n+$/, ''))); return;
      case 'list': {
        // Like @tiptap/markdown, a run of task items and a run of plain items are separate lists.
        const list = tok as Tokens.List;
        const runs: Tokens.ListItem[][] = [];
        for (const item of list.items) {
          const last = runs[runs.length - 1];
          if (last && !!last[0].task === !!item.task) last.push(item); else runs.push([item]);
        }
        let start = Number(list.start || 1);
        for (const run of runs) {
          const items: ListItem[] = [];
          listItems({ ...list, start, items: run }, [], false, items);
          out.push({ k: 'list', task: !!run[0].task, items });
          start += run.length;
        }
        return;
      }
      case 'blockquote': out.push({ k: 'quote', text: (tok as Tokens.Blockquote).text.trim() }); return;
      case 'code': out.push({ k: 'code', text: (tok as Tokens.Code).text, lang: (tok as Tokens.Code).lang?.split(/\s/)[0] }); return;
      case 'table': {
        const tbl = tok as Tokens.Table;
        out.push({ k: 'table', header: tbl.header.map((c) => c.text), rows: tbl.rows.map((r) => r.map((c) => c.text)), align: tbl.align });
        return;
      }
      case 'hr': out.push({ k: 'hr' }); return;
      default: if (tok.raw?.trim()) out.push({ k: 'p', text: tok.raw.trim() });
    }
  });
  return out;
}

/** WebKit keeps `a/b` and `https://x` whole where UIKit would break after the slash; a word joiner stops UIKit. */
const keepSlashes = (s: string) => s.replace(/\/(?=\w)/g, '/\u2060');

/** Inline markdown: bold, italic, code, links, tags. Enough to look like the editor for a moment. */
function Inline({ text, t, ty, base }: { text: string; t: Theme; ty: Typography; base: TextStyle }) {
  const parts: React.ReactNode[] = [];
  const face = textFont(ty.text);
  const re = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\([^)]*\)|(?<![\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*])|==(.+?)==|~~(.+?)~~|(?<!\S)((?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?'")\]]|[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  const plain = (s: string) => {
    let at = 0;
    for (const tag of findTags(s)) {
      if (tag.start > at) parts.push(keepSlashes(s.slice(at, tag.start)));
      const hue = t.tags[tagHue(tag.tag)];
      parts.push(
        <Text key={key++} style={{ backgroundColor: hue.bg, color: hue.fg, fontWeight: weightIn(face, '500') }}>
          {/* En spaces (half an em) stand in for the pill's 8–9px side padding. */}
          <Text style={{ fontWeight: weightIn(face, '600') }}>{'\u2002#'}</Text>
          {s.slice(tag.start + 1, tag.end) + '\u2002'}
        </Text>,
      );
      // A stray `/` after the tag is hidden in the editor too.
      at = tag.rawEnd;
    }
    if (at < s.length) parts.push(keepSlashes(s.slice(at)));
  };
  while ((m = re.exec(text))) {
    if (m.index > last) plain(text.slice(last, m.index));
    if (m[2] !== undefined) parts.push(<Text key={key++} style={{ fontWeight: '700' }}>{keepSlashes(m[2])}</Text>);
    else if (m[3] !== undefined) {
      // Spacers as wide as the editor's side padding; word joiners keep them on the code's line.
      parts.push(
        <View key={key++} style={styles.codePad} />, '\u2060',
        <Text key={key++} style={{ fontFamily: codeFont(ty.code).rn, fontSize: (base.fontSize ?? 17) * E.code, backgroundColor: t.colors.surface2 }}>{keepSlashes(m[3])}</Text>,
        '\u2060', <View key={key++} style={styles.codePad} />,
      );
    }
    else if (m[4] !== undefined || m[8] !== undefined) parts.push(<Text key={key++} style={{ color: t.colors.accent, textDecorationLine: 'underline', textDecorationColor: t.colors.accent + '66' }}>{keepSlashes(m[4] ?? m[8])}</Text>);
    else if (m[5] !== undefined) parts.push(<Text key={key++} style={{ fontStyle: 'italic' }}>{keepSlashes(m[5])}</Text>);
    else if (m[6] !== undefined) parts.push(<Text key={key++} style={{ backgroundColor: t.colors.volt + (t.name === 'dark' ? '59' : 'B3') }}>{keepSlashes(m[6])}</Text>);
    else if (m[7] !== undefined) parts.push(<Text key={key++} style={{ color: t.colors.textMuted, textDecorationLine: 'line-through' }}>{keepSlashes(m[7])}</Text>);
    last = re.lastIndex;
  }
  if (last < text.length) plain(text.slice(last));
  return <Text style={base}>{parts}</Text>;
}

/**
 * WebKit (the iOS editor) floors line boxes to whole points, rounds the font's
 * ascent and descent up to whole points, and centres them in the line, rounding
 * the top half-leading down. React Native keeps the fractional height, centres the
 * exact metrics, and when the line is shorter than the font drops the glyphs to the
 * bottom of the line instead. `cssLine` gives the editor's line height and the `top`
 * nudge that puts React Native's text on the editor's baseline (`top` moves the text
 * without moving anything else). The metrics come from the font table
 * (`src/theme/typography.ts`); the rounding was checked on the simulator for every
 * font there at sizes 10.5–42 and line heights 1.2–2.
 */
const IOS = Platform.OS === 'ios';
type Metrics = Pick<EditorFont, 'asc' | 'desc'>;

/**
 * React Native adds a physical pixel to any text height that lands exactly on the
 * pixel grid (TextMeasurementRounding.h), so a 26pt line would take 26.33pt and
 * every block would push the next one down. A hair less keeps whole-point lines whole.
 */
const fit = (lineHeight: number) => (IOS ? lineHeight - 0.01 : lineHeight);

function rnBaseline(lineHeight: number, size: number, m: Metrics) {
  const a = size * m.asc;
  const d = size * m.desc;
  return lineHeight >= a + d ? (lineHeight + a - d) / 2 : lineHeight - d;
}

function cssLine(size: number, ratio: number, m: Metrics) {
  if (!IOS) return { lineHeight: size * ratio, top: 0, baseline: rnBaseline(size * ratio, size, m), asc: size * m.asc, desc: size * m.desc };
  const lineHeight = Math.floor(size * ratio);
  // The epsilon keeps a whole number whole (Avenir Next's ascent is exactly 1 em).
  const asc = Math.ceil(size * m.asc - 1e-6);
  const desc = Math.ceil(size * m.desc - 1e-6);
  const baseline = Math.floor((lineHeight - asc - desc) / 2) + asc;
  return { lineHeight, top: baseline - rnBaseline(lineHeight, size, m), baseline, asc, desc };
}

/** Browser default markers by nesting depth: disc, circle, square. */
const BULLETS = ['•', '◦', '▪'];
const isTitle = (b: Extract<Block, { k: 'h' }>, i: number) => i === 0 && b.level === 1;
const headingSize = (b: Extract<Block, { k: 'h' }>, i: number, F: number) => F * (isTitle(b, i) ? E.title : E.h[b.level]);

/** Vertical margins per block from the editor CSS. `para` is the paragraph spacing in em. */
function margins(b: Block, i: number, F: number, para: number): { top: number; bottom: number } {
  switch (b.k) {
    case 'h': {
      const size = headingSize(b, i, F);
      return { top: size * (isTitle(b, i) ? E.titleTop : E.headTop), bottom: size * E.headBottom };
    }
    case 'list': return { top: F * E.liGap, bottom: F * para };
    case 'quote':
    case 'code':
    case 'table': return { top: 0, bottom: F * E.blockBottom };
    case 'hr': return { top: F * E.hr, bottom: F * E.hr };
    default: return { top: 0, bottom: F * para };
  }
}

/** Space above each block. CSS collapses adjacent vertical margins, so the larger one wins. */
function gapsFor(blocks: Block[], F: number, para: number): number[] {
  const m = blocks.map((b, i) => margins(b, i, F, para));
  return m.map((cur, i) => (i === 0 ? cur.top : Math.max(m[i - 1].bottom, cur.top)));
}

export const NotePreview = memo(function NotePreview({ md, t, ty }: { md: string; t: Theme; ty: Typography }) {
  const blocks = useMemo(() => parse(md), [md]);
  const gaps = useMemo(() => gapsFor(blocks, ty.size, ty.para), [blocks, ty.size, ty.para]);
  const F = ty.size;
  const P = ty.para;
  const text = textFont(ty.text);
  const head = textFont(ty.head);
  const mono = codeFont(ty.code);
  const line = cssLine(F, ty.line, text);
  const lh = line.lineHeight;
  const body: TextStyle = { fontFamily: text.rn, fontSize: F, lineHeight: fit(lh), top: line.top, color: t.colors.text };
  const code = cssLine(F * E.code, E.codeLine, mono);
  // A task's checkbox sits on the text baseline, so its label line is taller than the
  // text; a task item with nothing nested under it takes that height.
  const boxOuter = E.box + E.boxTop;
  const taskH = Math.max(lh, boxOuter + lh - line.baseline);
  const boxTop = Math.max(E.boxTop, line.baseline - E.box);
  // WebKit draws bullets as shapes, a little lower than the "•" glyph (measured).
  const bulletNudge = IOS ? F * 0.05 : 0;
  // A tag pill is the text's content box plus its padding, hung from the line's baseline.
  const pillText = line.asc + line.desc;
  const pill = { top: line.baseline - line.asc - E.pillTop, height: pillText + E.pillTop + E.pillBottom };
  const pillTextTop = line.asc - rnBaseline(pillText, F, text);

  const nodes = blocks.map((b, i) => {
    let el: React.ReactNode;
    if (b.k === 'h') {
      const size = headingSize(b, i, F);
      const hl = cssLine(size, E.headLine, head);
      const title = isTitle(b, i);
      el = <Inline text={b.text} t={t} ty={ty} base={{ fontFamily: head.rn, fontWeight: weightIn(head, title ? '800' : '700'), fontSize: size, lineHeight: fit(hl.lineHeight), top: hl.top, color: t.colors.text, letterSpacing: -size * (title ? 0.022 : 0.012) }} />;
    } else if (b.k === 'p') {
      el = <Inline text={b.text} t={t} ty={ty} base={body} />;
    } else if (b.k === 'empty') {
      el = <View style={{ height: lh }} />;
    } else if (b.k === 'tags') {
      el = b.rows.map((row, r) => (
        <View key={r} style={styles.tagRow}>
          {row.map((tag, j) => {
            const hue = t.tags[tagHue(tag)];
            return (
              <View key={j} style={{ height: lh, marginRight: F * 0.25 }}>
                <View style={[styles.pill, { backgroundColor: hue.bg, marginTop: pill.top, height: pill.height, paddingTop: E.pillTop }]}>
                  {/* One text run, like the editor: two rounded-up widths made each pill a hair wider. */}
                  <Text style={{ fontFamily: text.rn, fontSize: F, lineHeight: fit(pillText), top: pillTextTop, color: hue.fg, fontWeight: weightIn(text, '500') }}>
                    <Text style={{ fontWeight: weightIn(text, '600') }}>#</Text>{tag}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ));
    } else if (b.k === 'list') {
      el = (
        <View>
          {b.items.map((it, j) => {
            // Where the item's text starts: each enclosing list adds its padding (and a checkbox for tasks).
            const textLeft = it.lists.reduce((x, k) => x + (k === 'task' ? F * 0.2 + E.box + 10 : F * E.indent), 0);
            const prev = b.items[j - 1];
            const gap = !prev ? 0 : prev.closesNested === 'flex' ? F * (P + E.liGap) : prev.closesNested === 'block' ? F * P : F * E.liGap;
            const done = it.checked || it.muted;
            return (
              <View key={j} style={{ flexDirection: 'row', marginTop: gap, paddingLeft: textLeft, minHeight: it.marker === 'task' && !it.nested ? taskH : undefined }}>
                {it.marker === 'task' ? (
                  <View style={[styles.box, { left: textLeft - E.box - 10, marginTop: boxTop, borderColor: it.checked ? t.colors.volt : t.colors.textMuted, backgroundColor: it.checked ? t.colors.volt : 'transparent' }]}>
                    {it.checked ? <View style={[styles.tick, { borderColor: t.colors.onVolt }]} /> : null}
                  </View>
                ) : (
                  <Text style={[body, styles.marker, { color: t.colors.textMuted, top: line.top + (it.marker === 'bullet' ? bulletNudge : 0), left: textLeft - F * E.indent, width: F * E.indent - 6 }]}>
                    {it.marker === 'number' ? `${it.n}.` : BULLETS[Math.min(it.lists.length, 3) - 1]}
                  </Text>
                )}
                <View style={{ flex: 1 }}>
                  <Inline text={it.text} t={t} ty={ty} base={done ? { ...body, color: t.colors.textMuted, textDecorationLine: 'line-through' } : body} />
                </View>
              </View>
            );
          })}
          {b.items[b.items.length - 1]?.closesNested === 'flex' ? <View style={{ height: F * P }} /> : null}
        </View>
      );
    } else if (b.k === 'quote') {
      el = (
        <View style={[styles.quote, { borderLeftColor: t.name === 'dark' ? t.colors.volt : t.colors.accent }]}>
          <Inline text={b.text} t={t} ty={ty} base={{ ...body, color: t.colors.textSecondary }} />
          <View style={{ height: F * P }} />
        </View>
      );
    } else if (b.k === 'code') {
      el = (
        <View style={[styles.pre, { backgroundColor: t.colors.codeBg, borderColor: t.colors.border }]}>
          <Text style={{ fontFamily: mono.rn, fontSize: F * E.code, lineHeight: fit(code.lineHeight), top: code.top, color: t.colors.text }}>
            {highlightCode(b.text, b.lang)?.map((r, k) => (
              <Text key={k} style={r.role && { color: t.syntax[r.role], fontStyle: r.role === 'comment' ? 'italic' : 'normal' }}>{r.text}</Text>
            )) ?? b.text}
          </Text>
        </View>
      );
    } else if (b.k === 'table') {
      // Equal columns, like the editor's fixed table layout.
      const all = [b.header, ...b.rows];
      el = (
        <View style={[styles.table, { borderColor: t.colors.border }]}>
          {all.map((row, r) => (
            <View key={r} style={[styles.tr, r < all.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.colors.border }, r === 0 && { backgroundColor: t.colors.surface }]}>
              {b.header.map((_, c) => (
                <View key={c} style={[styles.td, c < b.header.length - 1 && { borderRightWidth: 1, borderRightColor: t.colors.border }]}>
                  <Inline text={row[c] || ' '} t={t} ty={ty} base={{ ...body, fontWeight: r === 0 ? weightIn(text, '600') : undefined, textAlign: b.align[c] ?? 'left' }} />
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    } else {
      el = <View style={{ height: 1, backgroundColor: t.colors.border }} />;
    }
    return <View key={i} style={{ marginTop: gaps[i] }}>{el}</View>;
  });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: t.colors.bg }]}>
      {nodes}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { paddingTop: E.padTop, paddingHorizontal: E.padX, overflow: 'hidden' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 999, paddingLeft: E.pillLeft, paddingRight: E.pillRight },
  marker: { position: 'absolute', textAlign: 'right' },
  box: { position: 'absolute', width: E.box, height: E.box, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 6, height: 11, borderRightWidth: 2.5, borderBottomWidth: 2.5, transform: [{ rotate: '45deg' }], marginTop: -2 },
  quote: { borderLeftWidth: 3, paddingLeft: 14, paddingVertical: 2 },
  table: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  tr: { flexDirection: 'row' },
  td: { flex: 1, flexBasis: 0, paddingVertical: E.cellY, paddingHorizontal: E.cellX },
  codePad: { width: E.codePadX, height: 1 },
  pre: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1 },
});

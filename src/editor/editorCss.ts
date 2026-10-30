import type { Theme } from '@/theme';
import { TYPOGRAPHY, codeFont, textFont, weightIn, type Typography } from '@/theme/typography';

/**
 * Sizes and margins of the editor page, in em of the body size unless noted. The line height
 * and paragraph spacing are settings (`Typography`). The native preview (`NotePreview`) lays the
 * note out from the same numbers.
 */
export const EDITOR = {
  headLine: 1.22,
  /** The first line of a note when it is a `# heading`. */
  title: 1.88,
  titleTop: 0.25,
  /** h1…h6 font sizes. */
  h: [0, 1.5, 1.28, 1.12, 1.02, 1.02, 1.02],
  /** Heading margins, in em of the heading's own size. */
  headTop: 1.15,
  headBottom: 0.45,
  liGap: 0.15,
  indent: 1.4,
  blockBottom: 1,
  hr: 1.4,
  /** Table cell padding in px; columns share the width equally. */
  cellY: 6,
  cellX: 10,
  /** Code size and its line height (in em of the code size). */
  code: 0.88,
  codeLine: 1.5,
  /** Inline code's side padding in px. */
  codePadX: 5,
  /** Page padding in px. */
  padTop: 4,
  padX: 22,
  /** Task checkbox in px. */
  box: 20,
  boxTop: 3,
  /** Tag pill padding in px. */
  pillTop: 2,
  pillBottom: 3,
  pillLeft: 8,
  pillRight: 9,
} as const;

/** CSS injected into the editor WebView: the theme's colours and the chosen type. */
export function editorCss(theme: Theme, ty: Typography = TYPOGRAPHY): string {
  const c = theme.colors;
  const e = EDITOR;
  const text = textFont(ty.text);
  const head = textFont(ty.head);
  const code = codeFont(ty.code).css;
  const dark = theme.name === 'dark';
  const hues = theme.tags.map((h, i) => `.vb-tag[data-hue="${i}"] { background: ${h.bg}; color: ${h.fg}; }`).join('\n  ');
  const syntax = Object.entries(theme.syntax).map(([role, color]) => `.vb-syn-${role} { color: ${color}; }`).join('\n  ');
  return `
  :root { color-scheme: ${theme.name}; }
  html, body { background: ${c.bg}; margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  body { font-family: ${text.css}; -webkit-font-smoothing: antialiased; }
  .ProseMirror {
    color: ${c.text}; font-size: ${ty.size}px; line-height: ${ty.line};
    padding: ${e.padTop}px ${e.padX}px 160px ${e.padX}px;
    outline: none; caret-color: ${c.accent}; word-wrap: break-word;
  }
  .ProseMirror ::selection { background: ${c.volt}${dark ? '4D' : '99'}; }
  .ProseMirror p { margin: 0 0 ${ty.para}em 0; }
  .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6 {
    font-family: ${head.css}; color: ${c.text}; font-weight: 700; line-height: ${e.headLine}; margin: ${e.headTop}em 0 ${e.headBottom}em 0; letter-spacing: -0.012em;
  }
  .ProseMirror h1 { font-size: ${e.h[1]}em; }
  .ProseMirror h2 { font-size: ${e.h[2]}em; }
  .ProseMirror h3 { font-size: ${e.h[3]}em; }
  .ProseMirror h4, .ProseMirror h5, .ProseMirror h6 { font-size: ${e.h[4]}em; }
  .ProseMirror > h1:first-child { margin-top: ${e.titleTop}em; font-size: ${e.title}em; font-weight: ${weightIn(head, '800')}; letter-spacing: -0.022em; }
  .ProseMirror a { color: ${c.accent}; text-decoration: underline; text-decoration-color: ${c.accent}66; text-underline-offset: 3px; }
  .ProseMirror strong { font-weight: 700; }
  .ProseMirror code {
    font-family: ${code}; font-size: ${e.code}em;
    background: ${c.surface2}; color: ${c.text}; padding: 1px ${e.codePadX}px; border-radius: 6px;
  }
  /* The block takes the code's own font and size, so its lines are code lines (no taller body-text strut). */
  .ProseMirror pre {
    font-family: ${code}; font-size: ${e.code}em; line-height: ${e.codeLine};
    background: ${c.codeBg}; border-radius: 12px; padding: 12px 14px; overflow-x: auto; margin: 0 0 ${e.blockBottom / e.code}em 0;
    border: 1px solid ${c.border};
  }
  .ProseMirror pre code { background: transparent; color: ${c.text}; padding: 0; font-size: 1em; line-height: inherit; }
  ${syntax}
  .vb-syn-comment { font-style: italic; }
  /* A \`\`\`mermaid block: the drawing, with its code only while the caret is inside (see editor-web/codeBlocks.ts). */
  .ProseMirror .vb-diagram { display: none; }
  .ProseMirror .vb-cb.vb-has-diagram .vb-diagram {
    display: block; position: relative; background: ${c.codeBg}; border: 1px solid ${c.border}; border-radius: 12px;
    padding: 12px; margin: 0 0 ${e.blockBottom}em 0; overflow: auto; -webkit-overflow-scrolling: touch;
  }
  .ProseMirror .vb-diagram.zoomed { max-height: 70vh; }
  .ProseMirror .vb-diagram .vb-art svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }
  .ProseMirror .vb-diagram.zoomed .vb-art svg { margin: 0; }
  .ProseMirror .vb-diagram .vb-edit {
    display: none; position: absolute; top: 8px; right: 8px; font: 600 12px/1 -apple-system, BlinkMacSystemFont, sans-serif;
    color: ${c.text}; background: ${c.surface2}; border: 0; border-radius: 999px; padding: 7px 11px;
  }
  .ProseMirror[contenteditable="true"] .vb-cb.vb-has-diagram:not(.vb-cb-active) .vb-edit { display: block; }
  .ProseMirror .vb-cb.vb-has-diagram:not(.vb-cb-active) pre { display: none; }
  .ProseMirror .vb-cb.vb-has-diagram.vb-cb-active pre { margin-bottom: 0; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .ProseMirror .vb-cb.vb-has-diagram.vb-cb-active .vb-diagram { border-top: 0; border-top-left-radius: 0; border-top-right-radius: 0; }
  .ProseMirror blockquote {
    border-left: 3px solid ${dark ? c.volt : c.accent}; margin: 0 0 ${e.blockBottom}em 0; padding: 2px 0 2px 14px; color: ${c.textSecondary};
  }
  .ProseMirror ul, .ProseMirror ol { padding-left: ${e.indent}em; margin: 0 0 ${ty.para}em 0; }
  .ProseMirror li { margin: ${e.liGap}em 0; }
  .ProseMirror li p { margin: 0; }
  .ProseMirror li::marker { color: ${c.textMuted}; }
  /* Fixed layout: equal columns, so the native preview can draw the same grid. */
  .ProseMirror table {
    width: 100% !important; table-layout: fixed; border-collapse: separate; border-spacing: 0;
    border: 1px solid ${c.border}; border-radius: 12px; margin: 0 0 ${e.blockBottom}em 0;
  }
  .ProseMirror th, .ProseMirror td {
    padding: ${e.cellY}px ${e.cellX}px; vertical-align: top; text-align: left; overflow-wrap: anywhere;
    border-right: 1px solid ${c.border}; border-bottom: 1px solid ${c.border};
  }
  .ProseMirror tr > *:last-child { border-right: 0; }
  .ProseMirror tr:last-child > * { border-bottom: 0; }
  .ProseMirror th { font-weight: ${weightIn(text, '600')}; background: ${c.surface}; }
  .ProseMirror tr:first-child > *:first-child { border-top-left-radius: 11px; }
  .ProseMirror tr:first-child > *:last-child { border-top-right-radius: 11px; }
  .ProseMirror th p, .ProseMirror td p { margin: 0; }
  .ProseMirror .selectedCell { background: ${c.volt}${dark ? '26' : '4D'}; }
  .ProseMirror hr { border: 0; border-top: 1px solid ${c.border}; margin: ${e.hr}em 0; }
  .ProseMirror .vb-image { margin: 0 0 ${e.blockBottom}em 0; line-height: 0; }
  .ProseMirror .vb-image img { max-width: 100%; height: auto; border-radius: 12px; display: block; }
  .ProseMirror .vb-image.ProseMirror-selectednode img { outline: 3px solid ${c.volt}; outline-offset: 2px; }
  .ProseMirror .vb-missing {
    line-height: 1.4; font-size: 0.82em; color: ${c.textMuted}; background: ${c.surface}; border: 1px dashed ${c.border};
    border-radius: 12px; padding: 12px 14px;
  }
  /* Voice notes and sound files: ![](attachments/x.m4a) */
  .ProseMirror .vb-audio {
    display: flex; align-items: center; gap: 12px; margin: 0 0 ${e.blockBottom}em 0; padding: 8px 14px 8px 8px;
    background: ${c.surface}; border: 1px solid ${c.border}; border-radius: 999px; line-height: 1; user-select: none; -webkit-user-select: none;
  }
  .ProseMirror .vb-play {
    flex: 0 0 auto; width: 40px; height: 40px; border-radius: 20px; border: 0; padding: 0; background: ${c.volt};
    display: flex; align-items: center; justify-content: center;
  }
  .ProseMirror .vb-play svg { width: 20px; height: 20px; fill: ${c.onVolt}; }
  .ProseMirror .vb-track { flex: 1 1 auto; height: 28px; position: relative; }
  .ProseMirror .vb-track::before { content: ""; position: absolute; left: 0; right: 0; top: 12px; height: 4px; border-radius: 2px; background: ${c.border}; }
  .ProseMirror .vb-fill { position: absolute; left: 0; top: 12px; height: 4px; border-radius: 2px; background: ${dark ? c.volt : c.accent}; width: 0; }
  .ProseMirror .vb-time { flex: 0 0 auto; font-size: 13px; font-variant-numeric: tabular-nums; color: ${c.textSecondary}; }
  .ProseMirror .vb-audio.vb-missing .vb-play { opacity: 0.4; }
  .ProseMirror mark { background: ${c.volt}${dark ? '59' : 'B3'} !important; color: inherit; border-radius: 3px; padding: 0 2px; }
  .ProseMirror s { color: ${c.textMuted}; }
  /* Tentap's own task-list CSS loads after this sheet; the .ProseMirror prefix keeps ours on top. */
  .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
  .ProseMirror ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 10px; }
  .ProseMirror ul[data-type="taskList"] > li > label { flex: 0 0 auto; margin: 0; user-select: none; }
  .ProseMirror ul[data-type="taskList"] > li > label > input {
    appearance: none; -webkit-appearance: none; width: ${e.box}px; height: ${e.box}px; margin: ${e.boxTop}px 0 0 0;
    border: 2px solid ${c.textMuted}; border-radius: 6px; background: transparent; position: relative; padding: 0;
  }
  .ProseMirror ul[data-type="taskList"] > li > label > input:checked { background: ${c.volt}; border-color: ${c.volt}; }
  .ProseMirror ul[data-type="taskList"] > li > label > input:checked::after {
    content: ""; position: absolute; left: 5px; top: 1px; width: 5px; height: 10px;
    border: solid ${c.onVolt}; border-width: 0 2.5px 2.5px 0; transform: rotate(45deg);
  }
  .ProseMirror ul[data-type="taskList"] > li[data-checked="true"] > div { color: ${c.textMuted}; text-decoration: line-through; }
  .ProseMirror ul[data-type="taskList"] > li > div { flex: 1 1 auto; }
  /* Plain lists nested in a task keep their bullets (tentap's CSS flexes every li under a task list). */
  .ProseMirror ul[data-type="taskList"] ul:not([data-type="taskList"]) > li,
  .ProseMirror ul[data-type="taskList"] ol > li { display: list-item; }
  /* Tag pills (decorations only; the file keeps plain #tag), tinted per tag. */
  .vb-tag {
    padding-top: ${e.pillTop}px; padding-bottom: ${e.pillBottom}px; -webkit-box-decoration-break: clone; box-decoration-break: clone;
  }
  .vb-tag-hash { border-radius: 999px 0 0 999px; padding-left: ${e.pillLeft}px; font-weight: ${weightIn(text, '600')}; }
  .vb-tag-name { border-radius: 0 999px 999px 0; padding-right: ${e.pillRight}px; font-weight: ${weightIn(text, '500')}; }
  /* A stray \`/\` or \`-\` after a tag (\`#work/\`), once the caret has moved on. */
  .vb-tag-tail { display: none; }
  ${hues}
  h1 .vb-tag, h2 .vb-tag, h3 .vb-tag { font-size: 0.6em; vertical-align: middle; }
  /* "Open" button under a link while the caret is in it (editor-web/links.ts). */
  .vb-link-chip {
    position: absolute; top: 0; left: 0; z-index: 5; display: inline-flex; align-items: center; gap: 7px; max-width: 72vw;
    font: 600 14px/1 -apple-system, BlinkMacSystemFont, sans-serif; color: ${c.text}; background: ${c.surface2};
    border: 1px solid ${c.border}; border-radius: 999px; padding: 10px 14px 10px 12px; margin: 0;
    box-shadow: 0 6px 18px rgba(0, 0, 0, ${dark ? 0.45 : 0.14}); user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  }
  .vb-link-chip[hidden] { display: none; }
  .vb-link-chip::before { content: ""; position: absolute; inset: -6px; }
  .vb-link-chip svg { flex: none; width: 15px; height: 15px; fill: none; stroke: ${dark ? c.volt : c.accent}; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .vb-link-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .is-editor-empty:first-child::before, p.is-empty:first-child::before {
    color: ${c.textMuted}; content: attr(data-placeholder); float: left; height: 0; pointer-events: none;
  }
  `;
}

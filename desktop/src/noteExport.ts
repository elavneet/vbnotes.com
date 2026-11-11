import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { api } from './api';
import { fileUrl } from './host';
import { openEditor } from './NoteEditor';
import { useNotes } from './store';

/** The note's ⋮ menu (`NoteMenu.tsx`): export, copy as, print, show the file. */

export const REVEAL_LABEL = /Mac/.test(navigator.platform) ? 'Show in Finder' : /^Win/.test(navigator.platform) ? 'Show in Explorer' : 'Show in Folder';

/** How exported and printed notes look: Paper's colours, the system font, nothing of the app around them. */
const NOTE_CSS = `
@page { margin: 18mm 16mm; }
.vb-export { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #17181C; max-width: 720px; margin: 0 auto; padding: 48px 24px; overflow-wrap: break-word; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.vb-export h1 { font-size: 2em; line-height: 1.2; font-weight: 800; margin: 0 0 0.6em; }
.vb-export h2 { font-size: 1.5em; line-height: 1.25; margin: 1.4em 0 0.5em; }
.vb-export h3 { font-size: 1.25em; margin: 1.3em 0 0.4em; }
.vb-export h4, .vb-export h5, .vb-export h6 { font-size: 1em; margin: 1.2em 0 0.4em; }
.vb-export p, .vb-export ul, .vb-export ol, .vb-export pre, .vb-export blockquote, .vb-export table, .vb-export .diagram { margin: 0 0 0.9em; }
.vb-export li > ul, .vb-export li > ol { margin: 0.2em 0 0; }
.vb-export li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.4em; }
.vb-export li > input[type=checkbox] { margin: 0 0.5em 0 0; }
.vb-export img, .vb-export svg { max-width: 100%; height: auto; }
.vb-export a { color: #4D7A0C; }
.vb-export code { font: 0.88em Menlo, Consolas, monospace; background: #F1EFEA; padding: 0.1em 0.35em; border-radius: 4px; }
.vb-export pre { background: #F1EFEA; padding: 12px 14px; border-radius: 8px; white-space: pre-wrap; }
.vb-export pre code { background: none; padding: 0; }
.vb-export blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #C8F25A; color: #4B4E57; }
.vb-export table { border-collapse: collapse; }
.vb-export th, .vb-export td { border: 1px solid #E2DED5; padding: 6px 10px; text-align: left; vertical-align: top; }
.vb-export th { background: #F1EFEA; }
.vb-export hr { border: 0; border-top: 1px solid #E2DED5; margin: 1.6em 0; }
.vb-export .diagram { text-align: center; }
@media print {
  .vb-export { max-width: none; padding: 0; font-size: 12pt; }
  .vb-export pre, .vb-export img, .vb-export .diagram, .vb-export tr { break-inside: avoid; }
  .vb-export h1, .vb-export h2, .vb-export h3 { break-after: avoid; }
}`;

const fileName = (path: string) => path.split('/').pop()!.replace(/\.(md|markdown|txt)$/i, '');

/** The note's text as it is now: the open note's edits are written first. */
async function textOf(path: string) {
  await openEditor.flush();
  return useNotes.getState().readText(path);
}

/** Files in the notes folder that the note links (`attachments/x.png`); not web addresses, not other notes. */
function linkedFiles(md: string) {
  const files = new Set<string>();
  for (const [, src] of md.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('#') || /\.(md|markdown)$/i.test(src)) continue;
    let path = src;
    try { path = decodeURIComponent(src); } catch {}
    files.add(path.replace(/^\.?\//, ''));
  }
  return [...files];
}

let diagrams = 0;

/** The note as HTML: GitHub-style markdown, pictures from `src`, Mermaid drawn in its light theme. */
async function noteHtml(md: string, src: (path: string) => string) {
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true, breaks: true })), 'text/html');
  doc.querySelectorAll('img').forEach((img) => img.setAttribute('src', src(img.getAttribute('src') ?? '')));
  for (const code of doc.querySelectorAll('pre > code.language-mermaid')) {
    try {
      const mermaid = (await import('mermaid')).default;
      // The theme as a directive: initialize() would change the editor's own diagrams too.
      const { svg } = await mermaid.render(`vb-export-${diagrams++}`, `%%{init: {"theme": "default"}}%%\n${code.textContent ?? ''}`);
      const box = doc.createElement('div');
      box.className = 'diagram';
      box.innerHTML = svg;
      code.parentElement!.replaceWith(box);
    } catch {
      // Code that doesn't parse stays as code.
    }
  }
  return doc.body.innerHTML;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

/**
 * Export › Markdown or HTML: the save dialog, then the file, with the pictures and sounds it links
 * copied beside it in `attachments/`, as in the notes folder, so the links keep working.
 */
export async function exportNote(path: string, format: 'md' | 'html') {
  const md = await textOf(path);
  const name = fileName(path);
  const to = await save({
    title: 'Export note',
    defaultPath: `${name}.${format}`,
    filters: [format === 'md' ? { name: 'Markdown', extensions: ['md'] } : { name: 'HTML', extensions: ['html'] }],
  });
  if (!to) return;
  const text = format === 'md' ? md : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(name)}</title>
<style>body { margin: 0; background: #fff; }${NOTE_CSS}</style>
</head>
<body><article class="vb-export">${await noteHtml(md, (s) => s)}</article></body>
</html>
`;
  await api.exportNote(to, text, linkedFiles(md));
}

/**
 * Print… and Export › PDF: the note goes into `#print-root`, the only thing the page prints
 * (`app.css`), and the system's print dialog opens. Its PDF button saves it as a file.
 */
export async function printNote(path: string) {
  const html = await noteHtml(await textOf(path), fileUrl);
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.innerHTML = `<style>${NOTE_CSS}</style><article class="vb-export">${html}</article>`;
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
  await api.printPage();
}

/** The text a pasted HTML note reads as: its words, one block a line. */
function plainText(html: string) {
  const box = document.createElement('div');
  box.style.cssText = 'position: fixed; left: -10000px; top: 0; width: 600px; white-space: normal;';
  box.innerHTML = html;
  document.body.appendChild(box);
  const text = box.innerText;
  box.remove();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Copy As: the clipboard gets its item at once, with the text still to come (WebKit only lets a
 * click write to the clipboard while the click is being handled).
 */
export function copyNoteAs(path: string, kind: 'md' | 'html' | 'text') {
  const md = textOf(path);
  const html = md.then((t) => noteHtml(t, (s) => s));
  const blob = (text: Promise<string>, type: string) => text.then((t) => new Blob([t], { type }));
  const item: Record<string, Promise<Blob>> = kind === 'html'
    ? { 'text/html': blob(html, 'text/html'), 'text/plain': blob(md, 'text/plain') }
    : { 'text/plain': blob(kind === 'md' ? md : html.then(plainText), 'text/plain') };
  return navigator.clipboard.write([new ClipboardItem(item)]);
}

/** Copy Link: a `[[link]]` to the note, to paste in another note. */
export const copyNoteLink = (path: string) => navigator.clipboard.writeText(`[[${fileName(path)}]]`);

/** Show in Finder (Explorer, the file manager): the note's file, selected. */
export function revealNote(path: string) {
  const folder = useNotes.getState().folder ?? '';
  const sep = folder.includes('\\') ? '\\' : '/';
  return revealItemInDir(`${folder.replace(/[\\/]+$/, '')}${sep}${path.split('/').join(sep)}`);
}

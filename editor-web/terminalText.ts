/**
 * Text copied out of a terminal (Claude Code, opencode, a command's output) turned back into
 * markdown before a paste reads it. A terminal hands over only what it drew: tables as
 * box-drawing lines (opencode gives tab-separated cells instead), diagrams as box-drawing art,
 * bullets as "•", every line behind the app's left margin, and long lines cut where the window
 * wrapped them. These come back as markdown tables, code blocks, `- ` items, unindented lines
 * and whole paragraphs. Headings and bold drawn by the terminal look like any other line there,
 * so they arrive as plain lines. Markdown and ordinary text pass through unchanged.
 */

const BAR = /[│┃║]/g;
const ROW = /^[│┃║].*[│┃║]$/;
/** A table border: box characters only, no spaces, with a corner or tee at each column's edge. */
const BORDER = /^[\u2500-\u257f]+$/;
const LINE = /[─━═╌╍┄┅┈┉]/g;
const DRAWN = /[─-╿]/;
/** A line of arrows between the boxes of a diagram. */
const ARROWS = /^[\s←-⇿▲-◅▼-▿]+$/;
const RULE = /^[─━═]{3,}$/;
const TABBED = /\S[ ]*\t/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+/;
const BULLET = /^(\s*)[•◦▪‣●○■]\s+/;
const FENCE = /^\s*(```|~~~)/;
/** Claude Code's mark before each reply. */
const REPLY = /^(\s*)⏺ /;

type Part = { md: string } | { lines: string[] };

const indentOf = (line: string) => /^ */.exec(line)![0].length;
const cell = (text: string) => text.trim().replace(/\|/g, '\\|');

function tableMd(rows: string[][]) {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), line(rows[0].map(() => '---').concat(Array(width - rows[0].length).fill('---'))), ...rows.slice(1).map(line)].join('\n');
}

/** Lines drawn with box characters: a table when every line is a border or a row with the same cells, else a diagram. */
function drawnMd(lines: string[]) {
  const t = lines.map((l) => l.trim());
  if (t.length === 1) return RULE.test(t[0]) ? '---' : null;
  const rows = t.filter((l) => ROW.test(l));
  const bars = rows.length ? rows[0].match(BAR)!.length : 0;
  const table = bars >= 3 && t.every((l) => ROW.test(l) ? l.match(BAR)!.length === bars : BORDER.test(l) && !/^[│┃║]/.test(l) && l.replace(LINE, '').length === bars);
  if (!table) return '```\n' + lines.join('\n') + '\n```';
  const cells = (l: string) => l.split(BAR).slice(1, -1).map((c) => c.trim());
  const groups: string[][][] = [[]];
  t.forEach((l) => (ROW.test(l) ? groups[groups.length - 1].push(cells(l)) : groups.push([])));
  const filled = groups.filter((g) => g.length);
  // A line between every row: each group is one row, its cells wrapped over several lines.
  const lined = filled.length > 2 || filled.every((g) => g.length === 1);
  const out: string[][] = [];
  for (const g of filled) {
    g.forEach((r, i) => {
      // Without lines between rows, a line with an empty first cell carries on the row above.
      if (lined ? i > 0 : i > 0 && !r[0] && out.length) out[out.length - 1] = out[out.length - 1].map((c, k) => [c, r[k]].filter(Boolean).join(' '));
      else out.push(r);
    });
  }
  return tableMd(out.map((r) => r.map(cell)));
}

/** Hard line breaks the terminal put where the window was full, joined back into lines. */
function unwrap(lines: string[], width: number) {
  const out: string[] = [];
  let last = '';
  let hang = -1;
  for (const line of lines) {
    const text = line.trim();
    const word = text.split(/\s/)[0];
    const carries =
      hang >= 0 && text && !ITEM.test(line) && !/^(#|>|\||```)/.test(text) && indentOf(line) === hang && last.length + 1 + word.length > width;
    if (carries) out[out.length - 1] += ' ' + text;
    else {
      out.push(line);
      const item = ITEM.exec(line);
      hang = !text ? -1 : item ? item[0].length : indentOf(line);
    }
    last = line;
  }
  return out;
}

export function fromTerminal(text: string) {
  if (!text.includes('\n')) return text;
  let lines = text.split('\n').map((l) => l.replace(/\s+$/, '').replace(REPLY, '$1  '));
  // The app's left margin. A selection often starts after it, so a first line that is no list
  // item may sit further left than the rest.
  const rest = lines.slice(1).filter((l) => l.trim());
  let margin = Math.min(...rest.map(indentOf), lines[0].trim() && ITEM.test(lines[0]) ? indentOf(lines[0]) : Infinity);
  if (!Number.isFinite(margin)) margin = 0;
  if (margin) lines = lines.map((l) => l.slice(Math.min(margin, indentOf(l))));

  const parts: Part[] = [];
  const prose = () => {
    const last = parts[parts.length - 1];
    if (last && 'lines' in last) return last.lines;
    const p = { lines: [] as string[] };
    parts.push(p);
    return p.lines;
  };
  let changed = margin > 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (FENCE.test(line)) {
      // Code that is already fenced stays as it is.
      const end = lines.findIndex((l, k) => k > i && FENCE.test(l));
      const stop = end < 0 ? lines.length : end + 1;
      prose().push(...lines.slice(i, stop));
      i = stop;
      continue;
    }
    let j = i;
    // A diagram's arrows and its indented labels between drawn lines belong to it.
    const inside = (k: number) => k > i && /^\s/.test(lines[k]) && (ARROWS.test(lines[k]) || lines.slice(k + 1, k + 3).some((l) => DRAWN.test(l)));
    while (j < lines.length && lines[j].trim() && (DRAWN.test(lines[j]) || inside(j))) j++;
    while (j > i + 1 && !DRAWN.test(lines[j - 1])) j--;
    const drawn = j > i ? drawnMd(lines.slice(i, j)) : null;
    if (drawn) {
      parts.push({ md: drawn });
      changed = true;
      i = j;
      continue;
    }
    j = i;
    while (j < lines.length && TABBED.test(lines[j])) j++;
    if (j - i >= 2) {
      parts.push({ md: tableMd(lines.slice(i, j).map((l) => l.split('\t').map(cell))) });
      changed = true;
      i = j;
      continue;
    }
    const bullet = line.replace(BULLET, '$1- ');
    if (bullet !== line) changed = true;
    prose().push(bullet);
    i++;
  }

  // Wrapped lines are joined only when the text looks wrapped: an app's margin, or most lines
  // ending where the next word would no longer have fitted.
  const all = parts.flatMap((p) => ('lines' in p ? p.lines : []));
  const width = Math.max(0, ...all.map((l) => l.length));
  let pairs = 0;
  let full = 0;
  all.forEach((l, k) => {
    const next = all[k + 1]?.trim();
    if (!l.trim() || !next || ITEM.test(all[k + 1])) return;
    pairs++;
    if (l.length + 1 + next.split(/\s/)[0].length > width) full++;
  });
  const wrapped = full > 0 && (margin >= 2 || (full >= 3 && full * 2 >= pairs));
  if (!changed && !wrapped) return text;
  // Tables and code blocks get a blank line either side, or markdown would not see them.
  const out: string[] = [];
  for (const p of parts) {
    if ('md' in p) {
      if (out.length && out[out.length - 1].trim()) out.push('');
      out.push(p.md, '');
    } else {
      const ls = wrapped ? unwrap(p.lines, width) : p.lines;
      if (out[out.length - 1] === '' && !ls[0]?.trim()) ls.shift();
      out.push(...ls);
    }
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

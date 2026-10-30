/**
 * Code colouring shared by the editor page (decorations) and the native preview (Text runs),
 * so a code block looks the same before and after the editor takes over.
 * Only a hand-picked set of languages is bundled; anything else stays plain. A block with no
 * language named is coloured as the language it looks like (`guessLanguage`).
 */
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml,
});

/**
 * A guess for a code block that names no language, from telltale lines. The first match wins, so
 * the specific languages come before the loose ones (`let` is Swift before it is JavaScript).
 * highlight.js's own guess called a JS config file CSS and plain prose Kotlin, so it is not used.
 */
const GUESSES: [string, RegExp][] = [
  ['php', /<\?php/],
  ['diff', /^(@@ .* @@|\+\+\+ \S|--- \S)/m],
  ['json', /^\s*(\{\s*"[^"\n]*"\s*:|\[\s*[{"\d\]])/],
  ['xml', /^\s*<(!DOCTYPE|\?xml|[a-zA-Z][\w:-]*[\s/>])/i],
  // Upper case, or lower case ending in `;`, so a sentence starting "Select … from" stays prose.
  ['sql', /^\s*(SELECT\s[\s\S]+?\sFROM\s|select\s[^;]+\sfrom\s[^;]+;|(INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE (TABLE|INDEX|VIEW|DATABASE)|ALTER TABLE|DROP TABLE|insert into|update \w+ set|delete from|create (table|index|view|database)|alter table|drop table)\b)/m],
  ['dockerfile', /^FROM \S+(\s+AS \w+)?\s*$/m],
  ['rust', /\bfn \w+\s*[(<]|\blet mut\b|\bimpl\b[^\n]*\{|\bprintln!\(/],
  ['swift', /\bfunc \w+\s*\([^)]*\w: |\bguard let\b|\bif let \w+ =|\bimport (UIKit|SwiftUI|Foundation)\b/],
  ['python', /^\s*(def \w+\s*\(.*\)\s*(->.*)?:\s*$|class \w+(\(.*\))?:\s*$|from [\w.]+ import |import [\w.]+(\s+as \w+)?\s*$|if __name__|elif\b)|\bprint\(/m],
  ['go', /^package \w+\s*$|^func (\(\w+ \*?\w+\) )?\w+\(|\bfmt\.\w+\(/m],
  ['kotlin', /\bfun \w+\s*\(|\bval \w+\s*[:=]/],
  ['cpp', /#include\s*[<"]|\bstd::|using namespace std/],
  ['csharp', /^using System|\bnamespace [\w.]+|Console\.Write/m],
  ['java', /\bpublic (static )?(final )?(class|void|interface)\b|System\.out\./],
  ['ruby', /^\s*(def \w+[^:\n]*$|require ['"]|puts |attr_(accessor|reader)\b|end\s*$)/m],
  ['typescript', /\binterface \w+\s*\{|\btype \w+\s*=|(\b(const|let|var)\s+\w+|[(,]\s*\w+\??)\s*:\s*(string|number|boolean|void|any|unknown)\b|\)\s*:\s*\w+(\[\])?\s*(\{|=>)/],
  ['javascript', /\b(const|let|var)\s+[\w{[]|\bfunction\b|=>|module\.exports|\brequire\(|^\s*(import|export)\s|console\.\w+\(/m],
  ['css', /[^{}\n]+\{\s*\n?\s*[\w-]+\s*:\s*[^;{}\n]+;/],
  ['yaml', /^\s*[\w-]+:(\s.+)?\n(\s*[\w-]+:|\s+- )/m],
  ['ini', /^\s*\[[\w. -]+\]\s*$|^[A-Z_][A-Z0-9_]*=\S/m],
  ['bash', /^\s*(\$ |sudo |cd |npm |npx |yarn |pnpm |bun |git |brew |pip3? |curl |wget |ls\b|mkdir |rm |cp |mv |export \w+=|echo |chmod |chown |ssh |scp |docker |pm2 |systemctl |apt(-get)? |cat |source |\.\/)|^#!\/.*\b(ba|z)?sh\b/m],
];

export function guessLanguage(code: string): string | null {
  return GUESSES.find(([, re]) => re.test(code))?.[0] ?? null;
}

export type SyntaxRole = 'keyword' | 'string' | 'number' | 'comment' | 'title' | 'type' | 'attr' | 'meta' | 'added' | 'removed';

/** highlight.js scope → colour role. Scopes not listed keep the code's text colour. */
const ROLES: Record<string, SyntaxRole> = {
  keyword: 'keyword', 'selector-tag': 'keyword', name: 'keyword', bullet: 'keyword',
  built_in: 'type', type: 'type', 'title.class_': 'type', 'title.class_.inherited__': 'type',
  title: 'title', 'title.function_': 'title', section: 'title', 'selector-id': 'title', 'selector-class': 'title',
  string: 'string', regexp: 'string', symbol: 'string', 'char.escape': 'string', link: 'string',
  number: 'number', literal: 'number',
  comment: 'comment', quote: 'comment', doctag: 'comment',
  attr: 'attr', attribute: 'attr', property: 'attr', variable: 'attr', 'template-variable': 'attr',
  'selector-attr': 'attr', 'selector-pseudo': 'attr',
  meta: 'meta',
  addition: 'added', deletion: 'removed',
};

export interface CodeRun { text: string; role: SyntaxRole | null }

type HastNode = { type: string; value?: string; children?: HastNode[]; properties?: { className?: string[] } };

function roleOf(classes: string[] | undefined): SyntaxRole | null | undefined {
  if (!classes?.length) return undefined;
  const base = classes[0].replace(/^hljs-/, '');
  return ROLES[[base, ...classes.slice(1)].join('.')] ?? ROLES[base] ?? undefined;
}

function walk(nodes: HastNode[], role: SyntaxRole | null, out: CodeRun[]) {
  for (const n of nodes) {
    if (n.type === 'text') {
      const last = out[out.length - 1];
      if (last && last.role === role) last.text += n.value ?? '';
      else out.push({ text: n.value ?? '', role });
    } else if (n.children) {
      walk(n.children, roleOf(n.properties?.className) ?? role, out);
    }
  }
}

const cache = new Map<string, CodeRun[] | null>();

/** Coloured runs covering all of `code`, or null when the language is unknown (shown plain). */
export function highlightCode(code: string, language?: string | null): CodeRun[] | null {
  // A block that names no language gets a guess; one that names an unknown one (`text`) stays plain.
  const lang = language?.trim().toLowerCase() || guessLanguage(code);
  if (!lang || !lowlight.registered(lang)) return null;
  const key = `${lang}\u0000${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let runs: CodeRun[] | null = null;
  try {
    runs = [];
    walk(lowlight.highlight(lang, code).children as HastNode[], null, runs);
  } catch {
    runs = null;
  }
  // Typing changes one block at a time; a small cache keeps the others from being re-coloured.
  if (cache.size > 64) cache.clear();
  cache.set(key, runs);
  return runs;
}

/** Plain-text helpers over raw markdown. Fast and regex-only; no parser. */
import { isTagLine } from './tags';

export function splitTitle(md: string): { title: string; body: string } {
  const text = md.replace(/^﻿/, '');
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return { title: '', body: '' };
  const first = lines[i];
  const h = /^#{1,6}\s+(.*)$/.exec(first);
  const title = (h ? h[1] : first).trim();
  const body = lines.slice(i + 1).join('\n');
  return { title: stripInline(title), body };
}

/** Removes markdown syntax for previews and search. */
export function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/(^|[^A-Za-z0-9])_(.*?)_(?![A-Za-z0-9])/g, '$1$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/==(.*?)==/g, '$1')
    .trim();
}

export function toPlainText(md: string): string {
  return md
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\d+\.\s+/, '')
        .replace(/^```.*$/, '')
        .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/, '')
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .replace(/\s*\|\s*/g, ' · ')
        .replace(/^---+$/, ''),
    )
    .map(stripInline)
    .join('\n');
}

export function previewOf(body: string, max = 160): string {
  const t = toPlainText(body.split('\n').filter((l) => !isTagLine(l)).join('\n')).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

export function firstImage(md: string): string | null {
  const m = /!\[[^\]]*\]\(([^)\s]+)/.exec(md);
  return m ? m[1] : null;
}

/** Safe file name from a title. */
export function fileNameFromTitle(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|#%{}$!'`@+=~^\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return clean || 'Untitled';
}

export function hashText(s: string): string {
  // FNV-1a 32-bit, enough to detect content changes.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + ':' + s.length;
}

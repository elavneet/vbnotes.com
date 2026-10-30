/**
 * The editor's type settings: the faces for text, headings and code, and the sizes around them.
 * Only faces that ship with iOS, so nothing is downloaded.
 */

type Weight = '400' | '500' | '600' | '700' | '800';

/**
 * A face: its CSS stack, its React Native family, and its ascender and descender per em as UIKit
 * reports them (measured on the simulator, 2026-10-30). WebKit rounds both up at each size, and
 * `NotePreview` uses them to put its text on the editor's baselines.
 */
export interface EditorFont {
  label: string;
  css: string;
  rn?: string;
  asc: number;
  desc: number;
  /** Weights the family lacks, mapped to one it has: UIKit and WebKit fall back to different faces. */
  weights?: Partial<Record<Weight, Weight>>;
}

export const TEXT_FONTS = {
  system: { label: 'System', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif', asc: 0.95215, desc: 0.24121 },
  rounded: { label: 'SF Rounded', css: 'ui-rounded, -apple-system, sans-serif', rn: 'ui-rounded', asc: 0.95215, desc: 0.24121 },
  newYork: { label: 'New York', css: 'ui-serif, Georgia, serif', rn: 'ui-serif', asc: 0.95215, desc: 0.24121 },
  avenir: { label: 'Avenir Next', css: '"Avenir Next", sans-serif', rn: 'Avenir Next', asc: 1, desc: 0.366 },
  charter: { label: 'Charter', css: 'Charter, serif', rn: 'Charter', asc: 0.97998, desc: 0.24023, weights: { 500: '400' } },
  georgia: { label: 'Georgia', css: 'Georgia, serif', rn: 'Georgia', asc: 0.91699, desc: 0.21924, weights: { 500: '400' } },
  iowan: { label: 'Iowan Old Style', css: '"Iowan Old Style", serif', rn: 'Iowan Old Style', asc: 1.03613, desc: 0.3291, weights: { 500: '400' } },
  palatino: { label: 'Palatino', css: 'Palatino, serif', rn: 'Palatino', asc: 0.82275, desc: 0.27734, weights: { 500: '400' } },
} satisfies Record<string, EditorFont>;

export const CODE_FONTS = {
  menlo: { label: 'Menlo', css: 'Menlo, "SF Mono", Consolas, monospace', rn: 'Menlo', asc: 0.92822, desc: 0.23584 },
  sfMono: { label: 'SF Mono', css: 'ui-monospace, Menlo, monospace', rn: 'ui-monospace', asc: 0.95215, desc: 0.24121 },
} satisfies Record<string, EditorFont>;

export type TextFontId = keyof typeof TEXT_FONTS;
export type CodeFontId = keyof typeof CODE_FONTS;

export interface Typography {
  /** Body size in px. */
  size: number;
  /** Line height, in em of the body size. */
  line: number;
  /** Space under a paragraph or list, in em. */
  para: number;
  text: TextFontId;
  head: TextFontId;
  code: CodeFontId;
}

export const TYPOGRAPHY: Typography = { size: 17, line: 1.55, para: 0.75, text: 'system', head: 'system', code: 'menlo' };

export const textFont = (id: string): EditorFont => TEXT_FONTS[id as TextFontId] ?? TEXT_FONTS.system;
export const codeFont = (id: string): EditorFont => CODE_FONTS[id as CodeFontId] ?? CODE_FONTS.menlo;
export const weightIn = (font: EditorFont, w: Weight): Weight => font.weights?.[w] ?? w;
export const typographyKey = (ty: Typography) => [ty.size, ty.line, ty.para, ty.text, ty.head, ty.code].join(':');

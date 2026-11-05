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
  /**
   * Where UIKit's named weights sit on a variable family's weight axis. iOS 27's WebKit puts a CSS
   * weight straight on the axis (800 is 800) while UIKit's Heavy is 860, so the editor's title came
   * out thinner than the preview's (6% less ink on an iPhone on 27.2). The editor's CSS uses these
   * numbers instead; iOS 26's WebKit draws them as it drew 800. Only the title's Heavy: Medium
   * and Semibold differ by 0.3%, and on Windows 510 would pick Segoe UI's Semibold.
   */
  wght?: Partial<Record<Weight, number>>;
  /**
   * Extra letter spacing (em) for the note's title in the native preview on iOS 26, whose WebKit
   * sets the heavy title of this family a little tighter than UIKit. Measured on iOS.
   */
  titleTrack?: number;
}

export const TEXT_FONTS = {
  // titleTrack: "Font check" 486 px wide in UIKit, 478 in WebKit (1.6%); 942 and 927 for a longer title.
  system: { label: 'System', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif', asc: 0.95215, desc: 0.24121, wght: { 800: 860 }, titleTrack: 0.008 },
  rounded: { label: 'SF Rounded', css: 'ui-rounded, -apple-system, sans-serif', rn: 'ui-rounded', asc: 0.95215, desc: 0.24121, wght: { 800: 858 } },
  newYork: { label: 'New York', css: 'ui-serif, Georgia, serif', rn: 'ui-serif', asc: 0.95215, desc: 0.24121, wght: { 800: 810 } },
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
  /** A number beside each line, as in a code editor (`editor-web/lineNumbers.ts`). */
  lines: boolean;
  /** How big Mermaid diagrams are drawn, against their own size (`DIAGRAM_SIZES`). */
  diagrams: DiagramSize;
}

export type DiagramSize = 'small' | 'medium' | 'large' | 'xlarge';
/** Each diagram size: its name in Settings and how many times Mermaid's own size it is drawn (never wider than the note). */
export const DIAGRAM_SIZES: Record<DiagramSize, { label: string; scale: number }> = {
  small: { label: 'Small', scale: 0.75 },
  medium: { label: 'Medium', scale: 1 },
  large: { label: 'Large', scale: 1.5 },
  xlarge: { label: 'X-Large', scale: 2 },
};

export const TYPOGRAPHY: Typography = { size: 17, line: 1.55, para: 0.75, text: 'system', head: 'system', code: 'menlo', lines: false, diagrams: 'medium' };

export const textFont = (id: string): EditorFont => TEXT_FONTS[id as TextFontId] ?? TEXT_FONTS.system;
export const codeFont = (id: string): EditorFont => CODE_FONTS[id as CodeFontId] ?? CODE_FONTS.menlo;
export const weightIn = (font: EditorFont, w: Weight): Weight => font.weights?.[w] ?? w;
/** A weight for CSS that draws the same face as `fontWeight: w` does in React Native. */
export const cssWeight = (font: EditorFont, w: Weight): number => {
  const named = weightIn(font, w);
  return font.wght?.[named] ?? Number(named);
};
export const typographyKey = (ty: Typography) => [ty.size, ty.line, ty.para, ty.text, ty.head, ty.code, ty.lines ? 'lines' : '', ty.diagrams].join(':');

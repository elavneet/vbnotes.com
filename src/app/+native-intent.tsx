/**
 * The share extension opens `vbnotes://dataUrl=…`; that is not a screen. Land on the notes list and
 * let `useSharedIn` (root layout) turn the shared text or photos into a note.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return path.includes('dataUrl=') ? '/' : path;
  } catch {
    return '/';
  }
}

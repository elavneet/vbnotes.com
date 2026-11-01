import type { VaultMeta } from '@/vault/types';

/** The welcome note, written by the phone (`welcome.ts`) and the desktop app (`desktop/src/welcome.ts`). */
export const WELCOME_NOTE = 'Welcome to VB Notes.md';
export const WELCOME_TITLE = 'Welcome to VB Notes';
export const WELCOME_PICTURE = 'attachments/welcome-mountains.png';

/**
 * Its version, kept in the folder's meta (`welcome`) so the phone and the desktop app agree on which
 * copy is newer. Raise it when either text changes; copies written before it was kept count as 1.
 */
export const WELCOME_VERSION = 2;

/**
 * What the first launch on a device does once its notes folder is chosen: write the welcome note
 * when the folder doesn't have it, replace a copy older than this version (the old one goes to
 * Trash, with anything written in it), or leave it. A copy that is still only in iCloud is left:
 * moving it before it comes down would leave a conflicted copy.
 */
export function welcomePlan(found: { cloud?: boolean } | undefined, meta: VaultMeta): 'write' | 'replace' | 'keep' {
  if (!found) return 'write';
  if (found.cloud || (meta.welcome ?? 1) >= WELCOME_VERSION) return 'keep';
  return 'replace';
}

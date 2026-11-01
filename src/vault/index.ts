import { Platform } from 'react-native';
import { Directory } from 'expo-file-system';
import { kvGetSync, kvSet } from '@/utils/kv';
import { LocalVault } from './localVault';
import { SafVault } from './safVault';
import { FolderAccess } from './folderAccess';
import type { Vault } from './types';

export * from './types';
export { LocalVault } from './localVault';
export { SafVault } from './safVault';

/** Where the notes live: the app's own folder, its folder in iCloud Drive, or one picked in Files. */
type Location = { kind: 'device' } | { kind: 'icloud'; uri: string } | { kind: 'picked'; uri: string; label: string; bookmark?: string };
const LOCATION_KEY = 'vault.location.v1';
const ICLOUD_LABEL = 'iCloud Drive · VB Notes';

/** The vault the app starts with: <Documents>/VBNotes. */
export function openDefaultVault(): Vault {
  return LocalVault.default();
}

// An Android folder is a `content://` tree, whose files have addresses of their own (`SafVault`).
const pickedVault = (dir: Directory, label: string) =>
  new (dir.uri.startsWith('content://') ? SafVault : LocalVault)(dir, `picked:${dir.uri}`, label, 'picked');
const iCloudVault = (dir: Directory) => new LocalVault(dir, 'icloud', ICLOUD_LABEL, 'icloud');

/** "iCloud Drive · Notes", "On this device · Notes" or just the folder name. */
function labelFor(uri: string): string {
  const parts = uri.replace(/\/+$/, '').split('/');
  let name = decodeURIComponent(parts[parts.length - 1] || 'Notes');
  // An Android folder is a tree id like `primary:Documents/Notes`.
  if (uri.startsWith('content://')) name = name.slice(name.lastIndexOf(':') + 1).split('/').pop() || 'Notes';
  if (uri.includes('/Mobile%20Documents/com~apple~CloudDocs') || uri.includes('/Mobile Documents/com~apple~CloudDocs')) return `iCloud Drive · ${name}`;
  if (uri.includes('/Containers/Data/Application/')) return `On this device · ${name}`;
  return name;
}

/**
 * The folder chosen last time, reopened. When it can no longer be reached (deleted, signed out
 * of iCloud) the app falls back to its own folder and says so. At once, so the first frame lists the notes.
 */
export function openSavedVault(): { vault: Vault; problem?: string } {
  const loc = kvGetSync<Location>(LOCATION_KEY);
  if (!loc || loc.kind === 'device') return { vault: openDefaultVault() };
  if (loc.kind === 'icloud') {
    // The app's own iCloud folder needs no bookmark; it is there while iCloud Drive is on.
    const dir = new Directory(loc.uri);
    if (dir.exists) return { vault: iCloudVault(dir) };
    return { vault: openDefaultVault(), problem: "Couldn't reach iCloud Drive, so these are the notes on this device. Check that iCloud Drive is on, then choose it again." };
  }
  try {
    let uri = loc.uri;
    if (Platform.OS === 'ios') {
      const opened = loc.bookmark && FolderAccess ? FolderAccess.open(loc.bookmark) : null;
      if (!opened) throw new Error('no access');
      uri = opened.uri;
      if (opened.bookmark !== loc.bookmark || uri !== loc.uri) void kvSet(LOCATION_KEY, { ...loc, uri, bookmark: opened.bookmark });
    }
    const dir = new Directory(uri);
    if (!dir.exists) throw new Error('gone');
    return { vault: pickedVault(dir, loc.label) };
  } catch {
    return { vault: openDefaultVault(), problem: `Couldn't open ${loc.label}, so these are the notes on this device. Choose the folder again to go back to it.` };
  }
}

/** Opens the Files folder picker. Null when the person cancels. */
export async function pickFolder(): Promise<{ vault: LocalVault; remember: () => Promise<void> } | null> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return null; // cancelled
  }
  const label = labelFor(dir.uri);
  let bookmark: string | undefined;
  if (Platform.OS === 'ios') {
    bookmark = FolderAccess?.bookmark(dir.uri) ?? undefined;
    if (!bookmark) throw new Error('This version of the app cannot keep that folder open. Update the app and try again.');
  }
  return {
    vault: pickedVault(dir, label),
    remember: () => kvSet<Location>(LOCATION_KEY, { kind: 'picked', uri: dir.uri, label, bookmark }),
  };
}

/**
 * The app's own folder in iCloud Drive, which shows there (and in Finder on a Mac) as "VB Notes".
 * Null when iCloud Drive is off or this build can't use it.
 */
export async function iCloudFolder(): Promise<{ vault: LocalVault; remember: () => Promise<void> } | null> {
  const uri = Platform.OS === 'ios' ? await FolderAccess?.iCloudFolder?.().catch(() => null) : null;
  if (!uri) return null;
  return { vault: iCloudVault(new Directory(uri)), remember: () => kvSet<Location>(LOCATION_KEY, { kind: 'icloud', uri }) };
}

/** iCloud Drive is on and this build can use it; nothing is made until the folder is chosen. */
export function canUseICloud(): boolean {
  return Platform.OS === 'ios' && !!FolderAccess?.iCloudFolder && !!FolderAccess.iCloudAvailable?.();
}

/**
 * A first launch asks where notes should live before anything is written: nothing chosen yet, no
 * welcome note made, and nothing in the device folder (people from before this question keep
 * theirs without being asked).
 */
export function folderNotChosen(): boolean {
  // 'welcomed' is WELCOMED_KEY in store/welcome.ts.
  if (kvGetSync<Location>(LOCATION_KEY) || kvGetSync<boolean>('welcomed')) return false;
  try {
    return !LocalVault.default().root.list().some((it) => !it.name?.startsWith('.'));
  } catch {
    return false;
  }
}

/** Back to the app's own folder. */
export async function chooseDeviceFolder(): Promise<Vault> {
  await kvSet<Location>(LOCATION_KEY, { kind: 'device' });
  return openDefaultVault();
}

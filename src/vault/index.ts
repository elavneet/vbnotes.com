import { Platform } from 'react-native';
import { Directory } from 'expo-file-system';
import { kvGetSync, kvSet } from '@/utils/kv';
import { LocalVault } from './localVault';
import { FolderAccess } from './folderAccess';
import type { Vault } from './types';

export * from './types';
export { LocalVault } from './localVault';

/** Where the notes live: the app's own folder, or one picked in Files. */
type Location = { kind: 'device' } | { kind: 'picked'; uri: string; label: string; bookmark?: string };
const LOCATION_KEY = 'vault.location.v1';

/** The vault the app starts with: <Documents>/VBNotes. */
export function openDefaultVault(): Vault {
  return LocalVault.default();
}

const pickedVault = (dir: Directory, label: string) => new LocalVault(dir, `picked:${dir.uri}`, label, 'picked');

/** "iCloud Drive · Notes", "On this device · Notes" or just the folder name. */
function labelFor(uri: string): string {
  const parts = uri.replace(/\/+$/, '').split('/');
  const name = decodeURIComponent(parts[parts.length - 1] || 'Notes');
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

/** Back to the app's own folder. */
export async function chooseDeviceFolder(): Promise<Vault> {
  await kvSet<Location>(LOCATION_KEY, { kind: 'device' });
  return openDefaultVault();
}

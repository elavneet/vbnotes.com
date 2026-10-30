import { requireOptionalNativeModule } from 'expo';

interface FolderAccessModule {
  /** A bookmark for a folder just picked, so it can be opened again after a relaunch. */
  bookmark(uri: string): string | null;
  /** Opens a saved folder: its URL now, and the bookmark to keep. Null when it is gone. */
  open(bookmark: string): { uri: string; bookmark: string } | null;
  /** Asks iCloud to download files that are only in the cloud; resolves with how many. */
  downloadFromCloud(uri: string): Promise<number>;
}

/**
 * iOS keeps a picked folder (iCloud Drive, another app's folder) open only for the session it
 * was picked in; this module (`modules/vb-folder`) keeps it open across launches. Null on
 * Android, where the picker already grants lasting access, and in builds made before it existed.
 */
export const FolderAccess = requireOptionalNativeModule<FolderAccessModule>('VbFolder');

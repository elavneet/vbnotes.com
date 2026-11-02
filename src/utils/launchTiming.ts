/**
 * How long the last start took, shown in Settings › About so a slow start on a phone can be
 * pinned down: from React Native starting to the notes list being laid out, and how much of that
 * went into opening the notes folder (a picked iCloud Drive folder is reopened from its bookmark).
 */
export const launch: { folderMs?: number; listMs?: number } = {};

/** Runs the notes folder's opening at launch and times it. */
export function timeFolder<T>(open: () => T): T {
  const started = Date.now();
  try {
    return open();
  } finally {
    launch.folderMs = Date.now() - started;
  }
}

/** The notes list is laid out. */
export function markListReady() {
  if (launch.listMs !== undefined) return;
  try {
    const p = performance as Performance & { rnStartupTiming?: { startTime?: number | null } };
    const start = p.rnStartupTiming?.startTime;
    if (typeof start === 'number') launch.listMs = Math.round(p.now() - start);
  } catch {
    // Not every runtime reports its start.
  }
}

/** "0.31 s, folder 0.12 s", or null before the list has shown. */
export function launchSummary(): string | null {
  if (launch.listMs === undefined) return null;
  const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
  return launch.folderMs === undefined ? s(launch.listMs) : `${s(launch.listMs)}, folder ${s(launch.folderMs)}`;
}

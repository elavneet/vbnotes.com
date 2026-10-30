import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { onContentsChanged, useNotes } from '@/store/notes';
import { useSettings } from '@/store/settings';
import { semanticIndex, type NoteSource } from './semanticIndex';

const INDEX_IDLE_MS = 4000;
const RETRY_MS = 2000;
const MAX_RETRIES = 3;

/**
 * Keeps the semantic index in step with the notes. Loads the model lazily
 * (only when smart search is on) and embeds notes as they change.
 */
export function useIndexing() {
  const smart = useSettings((s) => s.searchMode === 'smart');
  const model = useSettings((s) => s.searchModel);
  const vaultId = useNotes((s) => s.vault?.id);
  // A first scan fills the index in batches; a part of it would make `retain` drop the rest.
  const scanned = useNotes((s) => s.scanned);

  // A model download stops soon after the app leaves the screen. Coming back starts it
  // again, and the library carries on from the bytes it already has.
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || semanticIndex.status !== 'error') return;
      failures.current = 0;
      setAttempt((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!smart || !scanned) return;
    let active = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const text = (p: string) => useNotes.getState().readText(p).catch(() => undefined);
    const source: NoteSource = { hash: (p) => useNotes.getState().db?.hashOf(p), text };
    // Saves arrive every second while typing; embed once the writing pauses.
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offChanges = onContentsChanged((changed) => {
      changed.forEach((p) => pending.add(p));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const batch = [...pending];
        pending.clear();
        semanticIndex.schedule(batch, source);
      }, INDEX_IDLE_MS);
    });
    const off = () => { offChanges(); if (timer) clearTimeout(timer); };
    semanticIndex.setModel(model);
    (async () => {
      try {
        await semanticIndex.ensureEmbedder();
        failures.current = 0;
      } catch {
        // The stop is often only reported once the app is back; try again a few times
        // (an offline phone fails each time, so it stops there until the next return).
        const stopped = semanticIndex.embedderInfo?.paused && AppState.currentState === 'active';
        if (active && stopped && ++failures.current <= MAX_RETRIES) {
          retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
        }
        return;
      }
      if (!active) return;
      // One read of every note's hash; only notes whose text changed are read and embedded.
      const hashes = useNotes.getState().db?.hashes() ?? new Map<string, string>();
      const paths = [...hashes.keys()];
      // Notes from another folder (or deleted while the app was closed) leave the index.
      semanticIndex.retain(paths);
      semanticIndex.schedule(paths, { hash: (p) => hashes.get(p), text });
    })();
    return () => { active = false; off(); if (retry) clearTimeout(retry); };
  }, [smart, scanned, model, vaultId, attempt]);
}

import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useNotes } from '@/store/notes';
import { noteRoute } from '@/components/NotesList';
import { saveImage } from './attachments';

/**
 * Text, links and photos shared from other apps ("Save to VBNotes" in the share sheet) become a new
 * note, which then opens. Does nothing in Expo Go, which has no share extension.
 */
export function useSharedIn() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const ready = useNotes((s) => s.status === 'ready');
  const busy = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || !ready || busy.current) return;
    busy.current = true;
    (async () => {
      const parts: string[] = [];
      const title = shareIntent.meta?.title?.trim();
      if (title) parts.push(`# ${title}`);
      const text = shareIntent.text?.trim() || shareIntent.webUrl;
      if (text) parts.push(text);
      for (const f of shareIntent.files ?? []) {
        if (f.mimeType?.startsWith('image/')) parts.push(`![](${await saveImage(f.path, f.width ?? undefined, f.height ?? undefined)})`);
      }
      if (!parts.length) return;
      const path = await useNotes.getState().createNote(`${parts.join('\n\n')}\n`);
      router.push(noteRoute(path));
    })()
      .catch((e) => console.warn('could not save shared content', e))
      .finally(() => { resetShareIntent(); busy.current = false; });
  }, [hasShareIntent, ready, shareIntent, resetShareIntent]);
}

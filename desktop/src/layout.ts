import { create } from 'zustand';

/** Show Editor Only (⌃1), Notes and Editor (⌃2), Tags, Notes and Editor (⌃3). */
export type Layout = 'editor' | 'notes' | 'all';

const KEY = 'vbnotes.layout';
const saved = (): Layout => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'editor' || v === 'notes' ? v : 'all';
  } catch {
    return 'all';
  }
};

export const useLayout = create<{ layout: Layout; set: (layout: Layout) => void }>((set) => ({
  layout: saved(),
  set: (layout) => {
    try { localStorage.setItem(KEY, layout); } catch {}
    set({ layout });
  },
}));

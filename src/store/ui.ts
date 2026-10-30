import { create } from 'zustand';
import type { Section } from './notes';

interface UiState {
  section: Section;
  /** Tag filter (`dev/code`), `UNTAGGED`, or '' for all notes. */
  tag: string;
  /** Note shown in the right pane on wide screens. */
  selectedPath: string | null;
  setSection: (section: Section) => void;
  setTag: (tag: string) => void;
  select: (path: string | null) => void;
}

export const useUi = create<UiState>((set) => ({
  section: 'notes',
  tag: '',
  selectedPath: null,
  setSection: (section) => set({ section, tag: '' }),
  setTag: (tag) => set({ section: 'notes', tag }),
  select: (selectedPath) => set({ selectedPath }),
}));

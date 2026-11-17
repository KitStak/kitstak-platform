'use client';
/**
 * Shell UI state (zustand). Feature teams open shell surfaces through these actions:
 *   useShellStore.getState().openPalette()
 *   useShellStore.getState().openShortcuts()
 */
import { create } from 'zustand';

interface ShellState {
  readonly paletteOpen: boolean;
  readonly paletteQuery: string;
  readonly shortcutsOpen: boolean;
  openPalette(query?: string): void;
  closePalette(): void;
  setPaletteOpen(open: boolean): void;
  openShortcuts(): void;
  closeShortcuts(): void;
}

export const useShellStore = create<ShellState>()((set) => ({
  paletteOpen: false,
  paletteQuery: '',
  shortcutsOpen: false,
  openPalette: (query = '') => set({ paletteOpen: true, paletteQuery: query }),
  closePalette: () => set({ paletteOpen: false, paletteQuery: '' }),
  setPaletteOpen: (paletteOpen) => set(paletteOpen ? { paletteOpen } : { paletteOpen, paletteQuery: '' }),
  openShortcuts: () => set({ shortcutsOpen: true, paletteOpen: false }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
}));

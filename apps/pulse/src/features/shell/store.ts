'use client';
/**
 * Shell UI state (zustand). Feature teams open shell surfaces through these actions:
 *   useShellStore.getState().openPalette()
 *   useShellStore.getState().openShortcuts()
 * The sidebar collapse state persists per browser.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ShellState {
  readonly sidebarCollapsed: boolean;
  readonly mobileNavOpen: boolean;
  readonly paletteOpen: boolean;
  readonly paletteQuery: string;
  readonly shortcutsOpen: boolean;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  setMobileNavOpen(open: boolean): void;
  openPalette(query?: string): void;
  closePalette(): void;
  setPaletteOpen(open: boolean): void;
  openShortcuts(): void;
  closeShortcuts(): void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      paletteOpen: false,
      paletteQuery: '',
      shortcutsOpen: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      openPalette: (query = '') => set({ paletteOpen: true, paletteQuery: query }),
      closePalette: () => set({ paletteOpen: false, paletteQuery: '' }),
      setPaletteOpen: (paletteOpen) => set(paletteOpen ? { paletteOpen } : { paletteOpen, paletteQuery: '' }),
      openShortcuts: () => set({ shortcutsOpen: true, paletteOpen: false }),
      closeShortcuts: () => set({ shortcutsOpen: false }),
    }),
    {
      name: 'kitstak-pulse-shell',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);

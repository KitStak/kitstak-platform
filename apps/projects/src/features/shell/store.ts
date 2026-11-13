'use client';
/**
 * Shell UI state (zustand). Feature teams open shell surfaces through these actions:
 *   useShellStore.getState().openQuickAdd({ projectId, statusId, dueDate })
 *   useShellStore.getState().openPalette()
 *   useShellStore.getState().openShortcuts()
 * The sidebar collapse state persists per browser.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface QuickAddDefaults {
  readonly projectId?: string;
  readonly statusId?: string;
  readonly sectionId?: string | null;
  readonly assigneeId?: string | null;
  readonly dueDate?: string | null;
  readonly parentTaskId?: string | null;
  /** Prefilled text (natural-language parser input). */
  readonly text?: string;
}

interface ShellState {
  readonly sidebarCollapsed: boolean;
  readonly collapsedSpaceIds: readonly string[];
  readonly mobileNavOpen: boolean;
  readonly paletteOpen: boolean;
  readonly paletteQuery: string;
  readonly quickAdd: { readonly open: boolean; readonly defaults: QuickAddDefaults };
  readonly shortcutsOpen: boolean;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  toggleSpace(spaceId: string): void;
  setMobileNavOpen(open: boolean): void;
  openPalette(query?: string): void;
  closePalette(): void;
  setPaletteOpen(open: boolean): void;
  openQuickAdd(defaults?: QuickAddDefaults): void;
  closeQuickAdd(): void;
  openShortcuts(): void;
  closeShortcuts(): void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      collapsedSpaceIds: [],
      mobileNavOpen: false,
      paletteOpen: false,
      paletteQuery: '',
      quickAdd: { open: false, defaults: {} },
      shortcutsOpen: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      toggleSpace: (spaceId) =>
        set((state) => ({
          collapsedSpaceIds: state.collapsedSpaceIds.includes(spaceId)
            ? state.collapsedSpaceIds.filter((id) => id !== spaceId)
            : [...state.collapsedSpaceIds, spaceId],
        })),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      openPalette: (query = '') => set({ paletteOpen: true, paletteQuery: query }),
      closePalette: () => set({ paletteOpen: false, paletteQuery: '' }),
      setPaletteOpen: (paletteOpen) => set(paletteOpen ? { paletteOpen } : { paletteOpen, paletteQuery: '' }),
      openQuickAdd: (defaults = {}) => set({ quickAdd: { open: true, defaults }, paletteOpen: false }),
      closeQuickAdd: () => set((state) => ({ quickAdd: { open: false, defaults: state.quickAdd.defaults } })),
      openShortcuts: () => set({ shortcutsOpen: true }),
      closeShortcuts: () => set({ shortcutsOpen: false }),
    }),
    {
      name: 'kitstak-projects-shell',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed, collapsedSpaceIds: state.collapsedSpaceIds }),
    },
  ),
);

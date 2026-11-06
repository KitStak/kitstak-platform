'use client';
/**
 * Client UI state for the shell (Zustand). Layout preferences persist per browser;
 * panel/dialog state is session-only.
 */
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export const SIDEBAR_WIDTH_DEFAULT = 264;
export const SIDEBAR_WIDTH_MIN = 216;
export const SIDEBAR_WIDTH_MAX = 440;

export type ShellPanel = 'search' | 'notifications' | 'invite' | 'shortcuts' | null;

export type CreateEntityKind = 'board' | 'dashboard' | 'folder' | 'workspace';

export interface CreateRequest {
  readonly kind: CreateEntityKind;
  readonly workspaceId?: string;
  readonly folderId?: string | null;
  /** Board only: open the template center instead of the quick-create form (wizards slot). */
  readonly mode?: 'templates';
  /** Board only: preselect a template in the template center. */
  readonly templateId?: string;
  /** Prefill for the board name (e.g. the chosen template name). */
  readonly name?: string;
}

export type TreeSortMode = 'manual' | 'alpha';

interface ShellState {
  readonly sidebarCollapsed: boolean;
  readonly sidebarWidth: number;
  /** Workspace shown in the sidebar tree, per org id. */
  readonly activeWorkspaceByOrg: Readonly<Record<string, string>>;
  /** Expanded folder ids. */
  readonly expandedFolders: readonly string[];
  readonly favoritesOpen: boolean;
  /** Sidebar tree order per workspace id ("alpha": A–Z; absent: manual drag order). */
  readonly treeSortByWorkspace: Readonly<Record<string, TreeSortMode>>;
  readonly panel: ShellPanel;
  readonly createRequest: CreateRequest | null;
  /** Off-canvas navigation drawer (narrow viewports). Session-only. */
  readonly mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setActiveWorkspace: (orgId: string, workspaceId: string) => void;
  toggleFolder: (folderId: string) => void;
  expandFolders: (folderIds: readonly string[]) => void;
  collapseAllFolders: () => void;
  setFavoritesOpen: (open: boolean) => void;
  setTreeSort: (workspaceId: string, mode: TreeSortMode) => void;
  openPanel: (panel: Exclude<ShellPanel, null>) => void;
  closePanel: () => void;
  requestCreate: (request: CreateRequest) => void;
  clearCreateRequest: () => void;
}

/** Keeps only valid persisted sort modes (storage is untrusted). */
export function sanitizeTreeSort(raw: unknown): Readonly<Record<string, TreeSortMode>> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, TreeSortMode] => entry[1] === 'alpha')
      .slice(0, 200),
  );
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width)));
}

/** localStorage that tolerates private mode / blocked storage. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      /* storage unavailable: preferences stay in memory for this session */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* storage unavailable */
    }
  },
};

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      activeWorkspaceByOrg: {},
      expandedFolders: [],
      favoritesOpen: true,
      treeSortByWorkspace: {},
      panel: null,
      createRequest: null,
      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setActiveWorkspace: (orgId, workspaceId) =>
        set((state) => ({ activeWorkspaceByOrg: { ...state.activeWorkspaceByOrg, [orgId]: workspaceId } })),
      toggleFolder: (folderId) =>
        set((state) => ({
          expandedFolders: state.expandedFolders.includes(folderId)
            ? state.expandedFolders.filter((id) => id !== folderId)
            : [...state.expandedFolders, folderId],
        })),
      expandFolders: (folderIds) =>
        set((state) => {
          const missing = folderIds.filter((id) => !state.expandedFolders.includes(id));
          return missing.length ? { expandedFolders: [...state.expandedFolders, ...missing] } : state;
        }),
      collapseAllFolders: () => set({ expandedFolders: [] }),
      setFavoritesOpen: (open) => set({ favoritesOpen: open }),
      setTreeSort: (workspaceId, mode) =>
        set((state) => {
          const rest = Object.fromEntries(
            Object.entries(state.treeSortByWorkspace).filter(([id]) => id !== workspaceId),
          );
          return { treeSortByWorkspace: mode === 'manual' ? rest : { ...rest, [workspaceId]: mode } };
        }),
      openPanel: (panel) => set({ panel }),
      closePanel: () => set({ panel: null }),
      requestCreate: (request) => set({ createRequest: request }),
      clearCreateRequest: () => set({ createRequest: null }),
    }),
    {
      name: 'kitstak.shell.v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        activeWorkspaceByOrg: state.activeWorkspaceByOrg,
        expandedFolders: state.expandedFolders,
        favoritesOpen: state.favoritesOpen,
        treeSortByWorkspace: state.treeSortByWorkspace,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ShellState>;
        return {
          ...current,
          sidebarCollapsed:
            typeof saved.sidebarCollapsed === 'boolean' ? saved.sidebarCollapsed : current.sidebarCollapsed,
          sidebarWidth: clampSidebarWidth(
            typeof saved.sidebarWidth === 'number' ? saved.sidebarWidth : current.sidebarWidth,
          ),
          activeWorkspaceByOrg:
            saved.activeWorkspaceByOrg && typeof saved.activeWorkspaceByOrg === 'object'
              ? saved.activeWorkspaceByOrg
              : current.activeWorkspaceByOrg,
          expandedFolders: Array.isArray(saved.expandedFolders)
            ? saved.expandedFolders.filter((id): id is string => typeof id === 'string').slice(0, 500)
            : current.expandedFolders,
          favoritesOpen:
            typeof saved.favoritesOpen === 'boolean' ? saved.favoritesOpen : current.favoritesOpen,
          treeSortByWorkspace: sanitizeTreeSort(saved.treeSortByWorkspace),
        };
      },
    },
  ),
);

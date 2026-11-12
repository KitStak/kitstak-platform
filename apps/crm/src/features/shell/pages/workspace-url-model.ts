/** Pure query-string model for the workspace overview (tab, search, type, sort, folder). */
import type { ContentSort, ContentType } from './workspace-content-model';

export type WorkspaceTab = 'content' | 'members';

export interface WorkspaceUrlState {
  readonly tab: WorkspaceTab;
  readonly q: string;
  readonly type: ContentType;
  readonly sort: ContentSort;
  readonly folder: string | null;
}

const TYPES: readonly ContentType[] = ['all', 'board', 'dashboard', 'folder'];
const SORTS: readonly ContentSort[] = ['updated', 'name', 'type'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validated overview state from the query string; anything unknown falls back to defaults. */
export function parseWorkspaceParams(get: (key: string) => string | null): WorkspaceUrlState {
  const type = get('type');
  const sort = get('sort');
  const folder = get('folder');
  return {
    tab: get('tab') === 'members' ? 'members' : 'content',
    q: (get('q') ?? '').slice(0, 120),
    type: TYPES.includes(type as ContentType) ? (type as ContentType) : 'all',
    sort: SORTS.includes(sort as ContentSort) ? (sort as ContentSort) : 'updated',
    folder: folder && UUID.test(folder) ? folder : null,
  };
}

/** Query-string entries for a state, omitting defaults so URLs stay short. */
export function workspaceParamEntries(state: WorkspaceUrlState): Record<string, string | null> {
  return {
    tab: state.tab === 'content' ? null : state.tab,
    q: state.q.trim() ? state.q : null,
    type: state.type === 'all' ? null : state.type,
    sort: state.sort === 'updated' ? null : state.sort,
    folder: state.folder,
  };
}

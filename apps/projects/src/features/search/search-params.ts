/** URL model of the /search page (shared by the server page and the client view). */
import type { FullSearchTypeWithPrograms as FullSearchType } from '@/lib/types';

export interface SearchParamsState {
  readonly q: string;
  readonly type: FullSearchType;
  readonly projectId: string | null;
  readonly status: 'open' | 'done' | 'any';
  /** 'me', 'none' or a user id. */
  readonly assignee: string | null;
}

export const SEARCH_TYPES: readonly FullSearchType[] = ['all', 'tasks', 'comments', 'projects', 'programs', 'people', 'goals'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | null | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

export function parseSearchParams(raw: Record<string, string | string[] | undefined> | URLSearchParams): SearchParamsState {
  const get = (key: string) => (raw instanceof URLSearchParams ? (raw.get(key) ?? '') : one(raw[key]));
  const type = get('type') as FullSearchType;
  const status = get('status');
  const assignee = get('assignee');
  const project = get('project');
  return {
    q: get('q').slice(0, 200),
    type: SEARCH_TYPES.includes(type) ? type : 'all',
    projectId: UUID.test(project) ? project : null,
    status: status === 'open' || status === 'done' ? status : 'any',
    assignee: assignee === 'me' || assignee === 'none' || UUID.test(assignee) ? assignee : null,
  };
}

export function searchParamsToQuery(state: SearchParamsState): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.type !== 'all') params.set('type', state.type);
  if (state.projectId) params.set('project', state.projectId);
  if (state.status !== 'any') params.set('status', state.status);
  if (state.assignee) params.set('assignee', state.assignee);
  return params.toString();
}

/** Shared list/pagination types + helpers for the repository layer. */

export interface ListParams {
  page: number;
  pageSize: number;
  search?: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

export function offsetOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** Strip SQL LIKE wildcards from user input and wrap for a contains match. */
export function likePattern(search: string): string {
  return `%${search.replace(/[%_]/g, "")}%`;
}

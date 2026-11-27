/**
 * Browser calls for the import and export screens. Same JSON envelope and plain error messages
 * as the rest of /api/v1 (`ApiClientError`), plus the write methods the shared helper lacks.
 */
import { ApiClientError, apiGet, apiPath, apiPost } from '@/lib/api-client';
import type { StreamId } from '@/lib/streams';
import type { ImportBatchDTO, ImportOptions, ImportPresetDTO, ImportProgressDTO, ImportRowsPage, ImportStartDTO, ImportStreamSummaryDTO } from './types';

async function send<T>(method: 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', 'We could not reach KitStak. Check your connection and try again.', 0);
  }
  let payload: { data?: T; error?: { code: string; message: string; fields?: Record<string, string> } } | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.error) throw new ApiClientError(payload?.error?.code ?? 'INTERNAL', payload?.error?.message ?? 'Something went wrong. Please try again.', response.status, payload?.error?.fields);
  return payload.data as T;
}

export const importKeys = {
  root: ['imports'] as const,
  center: () => ['imports', 'center'] as const,
  batch: (id: string) => ['imports', 'batch', id] as const,
  rows: (id: string, params: Record<string, unknown>) => ['imports', 'batch', id, 'rows', params] as const,
  presets: (stream: string) => ['imports', 'presets', stream] as const,
  exportCounts: () => ['imports', 'export-counts'] as const,
};

export interface ImportCenterData {
  readonly batches: ImportBatchDTO[];
  readonly streams: ImportStreamSummaryDTO[];
}

export const importApi = {
  center: () => apiGet<ImportCenterData>(apiPath('import', { limit: 50 })),
  start: (input: { stream: StreamId; fileName: string | null; fileSize: number; fileHash: string | null; delimiter: string; headers: string[] }) => apiPost<ImportStartDTO>(apiPath('import'), input),
  appendRows: (batchId: string, rows: { n: number; cells: string[] }[], done: boolean) => apiPost<{ totalRows: number }>(apiPath(`import/${batchId}/rows`), { rows, done }),
  batch: (batchId: string) => apiGet<ImportBatchDTO>(apiPath(`import/${batchId}`)),
  rows: (batchId: string, params: { action?: string; offset?: number; limit?: number }) => apiGet<ImportRowsPage>(apiPath(`import/${batchId}/rows`, params)),
  check: (batchId: string, input: { mapping?: (string | null)[]; options?: Partial<ImportOptions>; savePresetAs?: string | null }) => apiPost<ImportBatchDTO>(apiPath(`import/${batchId}/check`), input),
  editRows: (batchId: string, edits: { rowNumber: number; cells?: string[]; skip?: boolean }[]) => send<ImportBatchDTO>('PATCH', apiPath(`import/${batchId}/rows`), { edits }),
  commit: (batchId: string) => apiPost<ImportBatchDTO>(apiPath(`import/${batchId}/commit`), {}),
  undo: (batchId: string) => apiPost<ImportBatchDTO>(apiPath(`import/${batchId}/undo`), {}),
  discard: (batchId: string) => send<{ discarded: boolean }>('DELETE', apiPath(`import/${batchId}`)),
  progress: (batchId: string) => apiGet<ImportProgressDTO>(apiPath(`import/${batchId}/progress`)),
  presets: (stream: string) => apiGet<ImportPresetDTO[]>(apiPath('import/presets', { stream })),
  savePreset: (input: { stream: string; name: string; headers: string[]; mapping: (string | null)[]; options?: Partial<ImportOptions> }) => apiPost<ImportPresetDTO[]>(apiPath('import/presets'), input),
  renamePreset: (presetId: string, name: string) => send<{ renamed: boolean }>('PATCH', apiPath(`import/presets/${presetId}`), { name }),
  deletePreset: (presetId: string) => send<{ deleted: boolean }>('DELETE', apiPath(`import/presets/${presetId}`)),
  exportCounts: () => apiGet<{ stream: StreamId; rows: number }[]>(apiPath('export')),
};

/** Download links (plain GET files). */
export const fileLinks = {
  template: (file: string) => `/api/v1/templates/${file}`,
  howTo: (file: string) => `/api/v1/templates/${file.replace(/\.csv$/, '')}-how-to.csv`,
  templateLines: () => '/api/v1/templates/job_plans-lines.csv',
  allTemplates: () => '/api/v1/templates/all.zip',
  errorReport: (batchId: string) => `/api/v1/import/${batchId}/errors.csv`,
  exportStream: (stream: string, params: Record<string, string | null | undefined>) => apiPath(`export/${stream}.csv`, params),
  exportEverything: (params: Record<string, string | null | undefined>) => apiPath('export/everything.zip', params),
  auditCsv: (params: Record<string, string | null | undefined>) => apiPath('export/audit.csv', params),
};

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

/**
 * Client for `/api/v1/imports/*` and `/api/v1/exports`. Uploads use XHR so the wizard can show
 * real upload progress; everything else goes through the shared typed fetcher.
 */
import { ApiClientError, apiRequest, buildApiUrl } from '@/lib/api';
import { ORG_HEADER, type ApiEnvelope } from '@/server/http/envelope';
import type {
  ExportInput,
  ImportBatchInput,
  ImportBatchResult,
  ImportCompleteInput,
  ImportMatchInput,
  ImportMatchResult,
  ImportRunSummary,
  ImportUndoInput,
  ImportUndoResult,
  ParseFileResult,
  PrepareImportInput,
  PrepareImportResult,
} from '@/server/services/import-export-contracts';

export function uploadForParse(
  orgId: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ParseFileResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildApiUrl('/imports/parse'));
    xhr.setRequestHeader(ORG_HEADER, orgId);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onerror = () => reject(new ApiClientError('NETWORK_ERROR', 'Network error. Check your connection and try again.', 0));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      let envelope: ApiEnvelope<ParseFileResult>;
      try {
        envelope = JSON.parse(xhr.responseText) as ApiEnvelope<ParseFileResult>;
      } catch {
        reject(new ApiClientError('INVALID_RESPONSE', "The server sent back something unexpected. Try uploading the file again.", xhr.status));
        return;
      }
      if (envelope.ok) resolve(envelope.data);
      else reject(new ApiClientError(envelope.error.code, envelope.error.message, xhr.status, envelope.error.details));
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.set('file', file);
    xhr.send(form);
  });
}

export function importApi(orgId: string) {
  const post = <T>(path: string, body: unknown) => apiRequest<T>(path, { orgId, method: 'POST', body });
  return {
    prepare: (input: PrepareImportInput) => post<PrepareImportResult>('/imports/prepare', input),
    match: (input: ImportMatchInput) => post<ImportMatchResult>('/imports/match', input),
    batch: (input: ImportBatchInput) => post<ImportBatchResult>('/imports/batches', input),
    complete: (input: ImportCompleteInput) => post<{ notified: boolean }>('/imports/complete', input),
    undo: (input: ImportUndoInput) => post<ImportUndoResult>('/imports/undo', input),
    run: (batchId: string) => apiRequest<ImportRunSummary>('/imports/runs', { orgId, query: { batchId } }),
  };
}

export interface DownloadedExport {
  readonly blob: Blob;
  readonly fileName: string;
  readonly rows: number;
}

function fileNameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to the ASCII name
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

export async function requestExport(orgId: string, input: Partial<ExportInput> & Pick<ExportInput, 'boardId' | 'format'>): Promise<DownloadedExport> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl('/exports'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: '*/*', [ORG_HEADER]: orgId },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', 'Network error. Check your connection and try again.', 0);
  }
  if (!response.ok) {
    let message = "Couldn't export this board.";
    let code: ApiClientError['code'] = 'INTERNAL';
    try {
      const envelope = (await response.json()) as ApiEnvelope<unknown>;
      if (!envelope.ok) {
        message = envelope.error.message;
        code = envelope.error.code;
      }
    } catch {
      // keep the generic message
    }
    throw new ApiClientError(code, message, response.status);
  }
  const blob = await response.blob();
  return {
    blob,
    fileName: fileNameFrom(response.headers.get('content-disposition'), `export.${input.format}`),
    rows: Number(response.headers.get('x-export-rows') ?? '0'),
  };
}

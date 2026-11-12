'use client';

/**
 * File uploads with real progress (XHR — fetch has no upload progress). Each entry moves
 * queued → uploading → done | error; failed entries can be retried or dismissed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';
import { useOrgId } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import { ORG_HEADER } from '@/server/http/envelope';
import type { FileDto } from '@/server/services/contracts/dto';

export type UploadStatus = 'uploading' | 'done' | 'error';

export interface UploadEntry {
  readonly id: string;
  readonly file: File;
  readonly progress: number;
  readonly status: UploadStatus;
  readonly error?: string;
  readonly result?: FileDto;
}

interface UploadTarget {
  readonly updateId?: string;
  readonly columnKey?: string;
}

function parseError(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through
  }
  if (xhr.status === 413) return 'The file is too large.';
  if (xhr.status === 0) return 'Network error. Check your connection.';
  return 'Upload failed. Please try again.';
}

/** Base request timeout plus extra time per MB, so large files on slow links still finish. */
export const UPLOAD_BASE_TIMEOUT_MS = 60_000;
export const UPLOAD_TIMEOUT_PER_MB_MS = 6_000;
export const UPLOAD_MAX_TIMEOUT_MS = 15 * 60_000;
/** No progress events for this long while bytes are still being sent = stalled connection. */
export const UPLOAD_STALL_MS = 30_000;

export function uploadTimeoutFor(bytes: number): number {
  const mb = Math.max(0, bytes) / (1024 * 1024);
  return Math.min(UPLOAD_MAX_TIMEOUT_MS, Math.round(UPLOAD_BASE_TIMEOUT_MS + mb * UPLOAD_TIMEOUT_PER_MB_MS));
}

/** Upload one file with progress callbacks. Resolves with the stored file. */
export function uploadWithProgress(
  orgId: string,
  itemId: string,
  file: File,
  target: UploadTarget,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<FileDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.set('file', file);
    if (target.updateId) form.set('updateId', target.updateId);
    if (target.columnKey) form.set('columnKey', target.columnKey);
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;
    const clearStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };
    const armStall = () => {
      clearStall();
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, UPLOAD_STALL_MS);
    };
    xhr.open('POST', buildApiUrl(`/items/${itemId}/files`));
    xhr.withCredentials = true;
    xhr.timeout = uploadTimeoutFor(file.size);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader(ORG_HEADER, orgId);
    xhr.upload.onprogress = (event) => {
      armStall();
      if (event.lengthComputable) onProgress(Math.min(0.99, event.loaded / event.total));
    };
    // All bytes sent: the server is processing; the overall timeout covers the rest.
    xhr.upload.onload = clearStall;
    xhr.onload = () => {
      clearStall();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const envelope = JSON.parse(xhr.responseText) as { ok: boolean; data: FileDto };
          onProgress(1);
          resolve(envelope.data);
        } catch {
          reject(new Error('Unexpected response from the server.'));
        }
      } else reject(new Error(parseError(xhr)));
    };
    xhr.onerror = () => {
      clearStall();
      reject(new Error(parseError(xhr)));
    };
    xhr.ontimeout = () => {
      clearStall();
      reject(new Error('Upload timed out. Check your connection and retry.'));
    };
    xhr.onabort = () => {
      clearStall();
      if (stalled) reject(new Error('Upload stalled. Check your connection and retry.'));
      else reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    armStall();
    xhr.send(form);
  });
}

export function useUploadQueue(itemId: string, boardId: string) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<readonly UploadEntry[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, next: Partial<UploadEntry>) => {
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)));
  }, []);

  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.itemFiles(orgId, itemId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.boardFiles(orgId, boardId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.itemActivity(orgId, itemId) }),
      ]),
    [boardId, itemId, orgId, queryClient],
  );

  const start = useCallback(
    async (entry: UploadEntry, target: UploadTarget): Promise<FileDto | null> => {
      const controller = new AbortController();
      controllers.current.set(entry.id, controller);
      try {
        const result = await uploadWithProgress(orgId, itemId, entry.file, target, (progress) => patch(entry.id, { progress }), controller.signal);
        patch(entry.id, { status: 'done', progress: 1, result });
        return result;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setEntries((list) => list.filter((candidate) => candidate.id !== entry.id));
          return null;
        }
        patch(entry.id, { status: 'error', error: error instanceof Error ? error.message : 'Upload failed' });
        return null;
      } finally {
        controllers.current.delete(entry.id);
      }
    },
    [itemId, orgId, patch],
  );

  /** Queue and upload files; resolves when all settle. Finished rows clear after a moment. */
  const upload = useCallback(
    async (files: readonly File[], target: UploadTarget = {}) => {
      const added = files.map<UploadEntry>((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        progress: 0,
        status: 'uploading',
      }));
      setEntries((list) => [...list, ...added]);
      const results = await Promise.all(added.map((entry) => start(entry, target)));
      await refresh();
      setTimeout(() => setEntries((list) => list.filter((entry) => entry.status !== 'done')), 1600);
      return results.filter((result): result is FileDto => result !== null);
    },
    [refresh, start],
  );

  const retry = useCallback(
    (id: string, target: UploadTarget = {}) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      const reset: UploadEntry = { ...entry, status: 'uploading', progress: 0, error: undefined };
      patch(id, reset);
      void start(reset, target).then(refresh);
    },
    [entries, patch, refresh, start],
  );

  const dismiss = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    setEntries((list) => list.filter((entry) => entry.id !== id));
  }, []);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
    };
  }, []);

  return { entries, upload, retry, dismiss };
}

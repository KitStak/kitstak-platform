'use client';
/**
 * Board export entry points for the board toolbar / menus:
 *
 *   await exportBoardCsv(boardId, view.config);                 // current view, CSV
 *   await exportBoardXlsx(boardId, view.config, { includeSubitems: true });
 *   const { exportBoard } = useBoardExport();                   // hook flavour (org from context)
 *
 * Each call shows "Your export is being prepared", downloads the file, then confirms (or shows
 * an error toast). Resolves with the downloaded row count, or null on failure.
 */
import { useCallback, useState } from 'react';
import { toast } from '@/components/ui';
import { errorMessage, useOrgId } from '@/lib/hooks';
import type { ViewConfigInput } from '@/server/services/contracts/structure-inputs';
import { requestExport } from './api';
import { downloadBlob } from './lib/error-report';

export interface ExportOptions {
  /** Organization id or slug. Defaults to the org in the current URL (`/<orgSlug>/…`). */
  readonly orgId?: string;
  readonly groupId?: string;
  /** Export only these items (multi-select "Export"). */
  readonly itemIds?: readonly string[];
  readonly includeSubitems?: boolean;
  /** Suppress toasts (caller shows its own feedback). */
  readonly silent?: boolean;
}

function orgFromLocation(): string {
  if (typeof window === 'undefined') throw new Error('exportBoard* must run in the browser');
  const slug = window.location.pathname.split('/').filter(Boolean)[0];
  if (!slug) throw new Error('No organization in the current URL; pass options.orgId');
  return slug;
}

async function runExport(
  format: 'csv' | 'xlsx',
  boardId: string,
  viewConfig: ViewConfigInput | Record<string, unknown> | undefined,
  options: ExportOptions,
): Promise<number | null> {
  const toastId = options.silent ? undefined : toast.loading('Your export is being prepared…');
  try {
    const result = await requestExport(options.orgId ?? orgFromLocation(), {
      boardId,
      format,
      ...(viewConfig ? { viewConfig: viewConfig as ViewConfigInput } : {}),
      ...(options.groupId ? { groupId: options.groupId } : {}),
      ...(options.itemIds?.length ? { itemIds: [...options.itemIds] } : {}),
      includeSubitems: options.includeSubitems ?? false,
    });
    downloadBlob(result.blob, result.fileName, result.blob.type);
    if (toastId !== undefined) {
      toast.dismiss(toastId);
      toast.success(
        'Export ready',
        `${result.rows.toLocaleString('en-US')} ${result.rows === 1 ? 'row' : 'rows'} saved to ${result.fileName}`,
      );
    }
    return result.rows;
  } catch (error) {
    if (toastId !== undefined) {
      toast.dismiss(toastId);
      toast.error("Couldn't export this board", errorMessage(error));
    }
    return null;
  }
}

/** Download the board (optionally as seen through a view) as CSV. */
export function exportBoardCsv(
  boardId: string,
  viewConfig?: ViewConfigInput | Record<string, unknown>,
  options: ExportOptions = {},
): Promise<number | null> {
  return runExport('csv', boardId, viewConfig, options);
}

/** Download the board (optionally as seen through a view) as an Excel workbook. */
export function exportBoardXlsx(
  boardId: string,
  viewConfig?: ViewConfigInput | Record<string, unknown>,
  options: ExportOptions = {},
): Promise<number | null> {
  return runExport('xlsx', boardId, viewConfig, options);
}

/** Hook flavour bound to the current org, with a pending flag for menu items. */
export function useBoardExport() {
  const orgId = useOrgId();
  const [pending, setPending] = useState<'csv' | 'xlsx' | null>(null);
  const exportBoard = useCallback(
    async (
      format: 'csv' | 'xlsx',
      boardId: string,
      viewConfig?: ViewConfigInput | Record<string, unknown>,
      options: Omit<ExportOptions, 'orgId'> = {},
    ) => {
      setPending(format);
      try {
        return await runExport(format, boardId, viewConfig, { ...options, orgId });
      } finally {
        setPending(null);
      }
    },
    [orgId],
  );
  return { exportBoard, pending };
}

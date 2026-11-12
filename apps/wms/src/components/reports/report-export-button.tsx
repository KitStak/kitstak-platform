'use client';

/**
 * Export As Excel for M13 report grids not yet in the shared export registry. Posts to
 * `POST /api/reports/exports` (same body as `/api/exports`); the file lands in the
 * Transactions tray and in Excel Export History exactly like every other export.
 */
import * as React from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { apiRequest, isApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import {
  BACKGROUND_TASKS_QUERY_KEY,
  browserTimeZone,
  EXPORT_STARTED_ACTION_LABEL,
  EXPORT_STARTED_MESSAGE,
  exportQueryString,
  type ExportColumnSpec,
} from '@/components/grid/export-button';
import { openTransactionsTray, refreshTransactions } from '@/lib/transactions-events';

export const REPORT_EXPORT_PATH = '/api/reports/exports';

export function ReportExportButton({
  gridKey,
  queryString,
  columns,
  total,
}: {
  readonly gridKey: string;
  readonly queryString: string;
  readonly columns?: readonly ExportColumnSpec[];
  readonly total: number;
}) {
  const queryClient = React.useContext(QueryClientContext);
  const [pending, setPending] = React.useState(false);
  const reason = pending ? 'Starting export…' : total === 0 ? 'There is nothing to export' : null;
  const run = async () => {
    setPending(true);
    try {
      await apiRequest(REPORT_EXPORT_PATH, {
        method: 'POST',
        body: {
          gridKey,
          query: exportQueryString(queryString),
          timeZone: browserTimeZone(),
          ...(columns?.length ? { columns } : {}),
        },
      });
      toast.show({
        variant: 'success',
        title: 'Export started',
        message: EXPORT_STARTED_MESSAGE,
        action: { label: EXPORT_STARTED_ACTION_LABEL, onClick: openTransactionsTray },
      });
      void queryClient?.invalidateQueries({ queryKey: BACKGROUND_TASKS_QUERY_KEY });
      refreshTransactions();
    } catch (error) {
      toast.error('Export failed', isApiError(error) ? error.message : 'The export could not be started.');
    } finally {
      setPending(false);
    }
  };
  return (
    <DisabledReason reason={reason}>
      <Button
        variant="success-outline"
        size="sm"
        disabled={Boolean(reason)}
        onClick={() => void run()}
        data-testid="report-export"
      >
        {pending ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : (
          <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
        )}
        Export As Excel
      </Button>
    </DisabledReason>
  );
}

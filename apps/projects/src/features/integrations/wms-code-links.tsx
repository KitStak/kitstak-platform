'use client';
/**
 * Quick add: WMS codes typed into a task name ("Investigate putaway delays on PO2240") become
 * links to that record. The code in the title is rewritten exactly as WMS formats it (PO002240),
 * so the task title and its linked-record chip always match.
 *
 *   const wms = useWmsCodeLinks(title, { enabled: open });
 *   <WmsCodeLinkChips state={wms} />
 *   title = wms.normalize(parsedTitle); after create: await wms.linkTo(task.id, title)
 */
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Tooltip, cn } from '@/components/ui';
import { apiGet, apiPath } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useIntegrationStatus, type ResolvedTargetDTO } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { findWmsCodes, normalizeWmsCodes, type WmsCodeMatch } from '@/lib/wms-codes';
import { addLinkAction } from '@/server/actions/links';
import { RecordStatus, SiblingAppMark } from './record-chip';

export interface WmsCodeLink {
  readonly match: WmsCodeMatch;
  readonly record: ResolvedTargetDTO;
}

export interface WmsCodeLinksState {
  /** Records the typed codes resolve to (dismissed ones left out). */
  readonly links: readonly WmsCodeLink[];
  readonly dismiss: (code: string) => void;
  /** Rewrites typed codes ("PO2240") to the WMS format ("PO002240"). */
  readonly normalize: (title: string) => string;
  /**
   * Links the records named in `title` to the new task (looked up again if the preview had not
   * finished). Never throws; returns how many were linked.
   */
  readonly linkTo: (taskId: string, title: string) => Promise<number>;
  readonly reset: () => void;
}

const codeOf = (record: ResolvedTargetDTO): string => {
  const fromMeta = record.meta?.code;
  return (typeof fromMeta === 'string' ? fromMeta : record.title.split(' · ')[0] ?? '').trim().toUpperCase();
};

export function useWmsCodeLinks(title: string, { enabled = true }: { readonly enabled?: boolean } = {}): WmsCodeLinksState {
  const status = useIntegrationStatus({ enabled });
  const wmsOn = Boolean(status.data?.wms);
  const debounced = useDebouncedValue(title, 250);
  const matches = useMemo(() => (wmsOn ? findWmsCodes(debounced) : []), [debounced, wmsOn]);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);

  const results = useQueries({
    queries: matches.map((match) => ({
      queryKey: qk.integrationSearch(match.type, match.code),
      queryFn: () => apiGet<ResolvedTargetDTO[]>(apiPath('integrations/search', { type: match.type, q: match.code })),
      enabled: enabled && wmsOn,
      staleTime: 60_000,
    })),
  });

  const links: WmsCodeLink[] = [];
  matches.forEach((match, index) => {
    if (dismissed.includes(match.code)) return;
    const record = results[index]?.data?.find((candidate) => codeOf(candidate) === match.code);
    if (record) links.push({ match, record });
  });

  const normalize = useCallback((text: string) => (wmsOn ? normalizeWmsCodes(text, findWmsCodes(text)) : text), [wmsOn]);

  const queryClient = useQueryClient();
  const linkTo = useCallback(
    async (taskId: string, text: string) => {
      if (!wmsOn) return 0;
      let linked = 0;
      for (const match of findWmsCodes(text)) {
        if (dismissed.includes(match.code)) continue;
        try {
          const found = await queryClient.fetchQuery({
            queryKey: qk.integrationSearch(match.type, match.code),
            queryFn: () => apiGet<ResolvedTargetDTO[]>(apiPath('integrations/search', { type: match.type, q: match.code })),
            staleTime: 60_000,
          });
          const record = found.find((candidate) => codeOf(candidate) === match.code);
          if (!record) continue;
          const result = await addLinkAction({ taskId, targetType: record.type, targetId: record.id });
          if (result.ok) linked += 1;
        } catch {
          // The task is created either way; the link can still be added from the task.
        }
      }
      return linked;
    },
    [dismissed, queryClient, wmsOn],
  );

  const dismiss = useCallback((code: string) => setDismissed((list) => (list.includes(code) ? list : [...list, code])), []);
  const reset = useCallback(() => setDismissed([]), []);
  return { links, dismiss, normalize, linkTo, reset };
}

/** "Links to PO002240 · Purchase order" chips under the quick-add title. */
export function WmsCodeLinkChips({ state, className }: { readonly state: WmsCodeLinksState; readonly className?: string }) {
  if (state.links.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="quick-add-wms-links">
      <span className="text-xs text-fg-muted">Links to</span>
      {state.links.map(({ match, record }) => (
        <span
          key={match.code}
          className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border-default bg-panel pr-1 pl-2 text-xs text-fg"
          data-testid="quick-add-wms-link"
        >
          <SiblingAppMark app="wms" size={12} />
          <span className="truncate font-medium tabular-nums slashed-zero">{record.title}</span>
          {record.status ? <RecordStatus status={record.status} /> : null}
          <Tooltip content={`Don't link ${match.code}`}>
            <button
              type="button"
              aria-label={`Don't link ${match.code}`}
              onClick={() => state.dismiss(match.code)}
              className="inline-flex size-4 items-center justify-center rounded-full text-icon hover:bg-hover hover:text-fg"
            >
              <X aria-hidden className="size-3" />
            </button>
          </Tooltip>
        </span>
      ))}
    </div>
  );
}

'use client';

/**
 * Record summary rail (BUILD_PLAN F4.4): Save + Other Actions; summary card with code,
 * status pill, Last Update, Show Change Log and totals; slots for Assigned Jobs,
 * Billing Charges and Printouts.
 */
import * as React from 'react';
import { ChevronDown, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/format';
import type { StatusDomain } from '@/lib/status-colors';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusPill } from '@/components/ui/status-pill';
import { DisabledReason } from '@/components/ui/tooltip';
import type { RowAction } from '@/components/grid/grid-types';
import { ChangeLogDrawer } from './change-log-drawer';
import { KvList, type KvItem } from './kv-list';

export interface RecordSummaryRailProps {
  readonly entityType: string;
  readonly entityId: string;
  readonly code: string;
  readonly status?: string | null;
  readonly statusDomain?: StatusDomain;
  readonly updatedAt?: string | null;
  readonly updatedBy?: string | null;
  readonly totals?: readonly KvItem[];
  readonly onSave?: () => void;
  readonly saveLabel?: string;
  readonly saveDisabledReason?: string | null;
  readonly saving?: boolean;
  readonly otherActions?: readonly RowAction[];
  readonly assignedJobs?: React.ReactNode;
  readonly billingCharges?: React.ReactNode;
  readonly printouts?: React.ReactNode;
  readonly className?: string;
}

function RailCard({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h3 className="mb-3 text-2xs font-semibold text-faint">{title}</h3>
      {children}
    </section>
  );
}

export function RecordSummaryRail({
  entityType,
  entityId,
  code,
  status,
  statusDomain,
  updatedAt,
  updatedBy,
  totals = [],
  onSave,
  saveLabel = 'Save',
  saveDisabledReason,
  saving,
  otherActions = [],
  assignedJobs,
  billingCharges,
  printouts,
  className,
}: RecordSummaryRailProps) {
  const fmt = useFormat();
  const [logOpen, setLogOpen] = React.useState(false);
  const saveReason = saving ? 'Saving…' : (saveDisabledReason ?? null);
  return (
    <aside
      className={cn('flex w-full flex-col gap-3 lg:sticky lg:top-4 lg:w-[300px]', className)}
      aria-label="Record summary"
    >
      {onSave || otherActions.length ? (
        <div className="flex gap-2">
          {onSave ? (
            <DisabledReason reason={saveReason}>
              <Button variant="primary" className="flex-1" disabled={Boolean(saveReason)} onClick={onSave}>
                {saveLabel}
              </Button>
            </DisabledReason>
          ) : null}
          {otherActions.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" className={cn(!onSave && 'flex-1')}>
                  Other Actions
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[220px]">
                {otherActions.map((a) => (
                  <DropdownMenuItem
                    key={a.key}
                    icon={a.icon}
                    destructive={a.destructive}
                    disabledReason={a.disabledReason}
                    onSelect={() => a.onSelect?.()}
                  >
                    {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
      <RailCard title="Summary">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="truncate text-md font-semibold text-foreground">{code}</span>
          {status ? <StatusPill status={status} domain={statusDomain} /> : null}
        </div>
        <KvList
          columns={1}
          layout="inline"
          items={[
            {
              key: 'updated',
              label: 'Last update',
              value: updatedAt ? `${fmt.dateTime(updatedAt)}${updatedBy ? ` · ${updatedBy}` : ''}` : null,
            },
            ...totals,
          ]}
        />
        <Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={() => setLogOpen(true)}>
          <History className="h-3.5 w-3.5" aria-hidden />
          Show change log
        </Button>
      </RailCard>
      {assignedJobs ? <RailCard title="Assigned jobs">{assignedJobs}</RailCard> : null}
      {billingCharges ? <RailCard title="Billing charges">{billingCharges}</RailCard> : null}
      {printouts ? <RailCard title="Printouts">{printouts}</RailCard> : null}
      <ChangeLogDrawer
        open={logOpen}
        onOpenChange={setLogOpen}
        entityType={entityType}
        entityId={entityId}
        entityCode={code}
      />
    </aside>
  );
}

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '../button';
import { ProgressRing } from '../progress-ring';
import { Spinner } from '../spinner';
import { DisabledReason } from '../tooltip';

export interface WizardRailProps {
  readonly title?: React.ReactNode;
  readonly percent: number;
  readonly statusLabel?: React.ReactNode;
  /** Summary slot (key facts of the record being built). */
  readonly children?: React.ReactNode;
  readonly saveLabel?: string;
  readonly onSave?: () => void;
  readonly saving?: boolean;
  readonly saveDisabledReason?: string | null;
  readonly className?: string;
}

/** Right-rail status card: progress ring %, summary, primary save. */
export function WizardRail({
  title = 'Status',
  percent,
  statusLabel,
  children,
  saveLabel = 'Save',
  onSave,
  saving,
  saveDisabledReason,
  className,
}: WizardRailProps) {
  return (
    <aside
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs lg:sticky lg:top-4',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <ProgressRing
          value={percent}
          size={56}
          thickness={5}
          tone={percent >= 100 ? 'success' : 'primary'}
          label="Completion"
        />
        <div className="min-w-0">
          <p className="text-2xs font-semibold text-faint">{title}</p>
          <p className="text-sm font-semibold text-foreground">
            {statusLabel ?? (percent >= 100 ? 'Ready to save' : 'In progress')}
          </p>
        </div>
      </div>
      {children ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs">{children}</div>
      ) : null}
      {onSave ? (
        <DisabledReason reason={saving ? null : saveDisabledReason}>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={onSave}
            disabled={saving || Boolean(saveDisabledReason)}
            aria-busy={saving}
          >
            {saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
            {saveLabel}
          </Button>
        </DisabledReason>
      ) : null}
    </aside>
  );
}

/** One "Label: value" row inside the rail summary. */
export function RailRow({
  label,
  children,
}: {
  readonly label: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-faint">{label}</span>
      <span className="min-w-0 text-right font-medium text-body">{children ?? 'None'}</span>
    </div>
  );
}

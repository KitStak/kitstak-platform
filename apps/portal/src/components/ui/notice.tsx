import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE: Readonly<Record<NoticeTone, string>> = {
  info: 'border-info/25 bg-info-subtle text-info-text',
  success: 'border-success/25 bg-success-subtle text-success-text',
  warning: 'border-warning/25 bg-warning-subtle text-warning-text',
  danger: 'border-danger/25 bg-danger-subtle text-danger-text',
  neutral: 'border-border-default bg-sunken text-fg-secondary',
};

const ICON = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert, neutral: Info } as const;

export interface NoticeProps {
  readonly tone?: NoticeTone;
  readonly children: ReactNode;
  /** Buttons or links shown at the end of the message. */
  readonly action?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
  /** Overrides the role. Default: alert for warning and danger, status for the rest. */
  readonly role?: 'alert' | 'status' | 'note';
}

/** An inline message with an icon. Never color alone: the icon and the words carry the meaning. */
export function Notice({ tone = 'info', children, action, className, testId, role }: NoticeProps) {
  const Icon = ICON[tone];
  const resolvedRole = role ?? (tone === 'warning' || tone === 'danger' ? 'alert' : 'status');
  return (
    <div
      role={resolvedRole === 'note' ? undefined : resolvedRole}
      data-testid={testId}
      className={cn(
        'flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        TONE[tone],
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 font-medium">{children}</div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2 pl-6.5 sm:pl-0">{action}</div> : null}
    </div>
  );
}

/**
 * The two Portal only rows under the top bar: the "Test mode" strip and the verify email notice.
 * The plan notice itself is the shared `PlanBanner` from `@kitstak/ui/plan-banner`, the same
 * component every product app shows (docs/billing/CONTRACTS.md section 17). These rows use the same
 * layout and tokens, so the three read as one stack. They cannot be hidden, so this file needs no
 * client code.
 */
import { FlaskConical, Info } from 'lucide-react';
import { cn } from '@/components/ui';

export interface NoticeBarNotice {
  readonly kind: string;
  readonly tone: 'info' | 'test';
  readonly text: string;
  readonly action: { readonly label: string; readonly href: string; readonly testId: string } | null;
  readonly testId: string;
}

const TONE: Readonly<Record<NoticeBarNotice['tone'], string>> = {
  info: 'border-info/20 bg-info-subtle text-info-text',
  test: 'border-warning/25 bg-warning-subtle text-warning-text',
};
const ICON = { info: Info, test: FlaskConical } as const;

export function PortalNoticeBar({ notice }: { readonly notice: NoticeBarNotice }) {
  const Icon = ICON[notice.tone];
  return (
    <div role="status" data-testid={notice.testId} className={cn('border-b print:hidden', TONE[notice.tone])}>
      <div
        className={cn(
          'mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 sm:px-6',
          // The test mode strip is a quiet label. Notices are full 44 px rows.
          notice.tone === 'test' ? 'min-h-8 py-1' : 'min-h-11 py-2',
        )}
      >
        <Icon aria-hidden className={cn('shrink-0', notice.tone === 'test' ? 'size-3.5' : 'size-4')} />
        <p className={cn('min-w-0 flex-1 basis-56 font-medium', notice.tone === 'test' ? 'text-xs' : 'text-sm')}>{notice.text}</p>
        {notice.action ? (
          <a
            href={notice.action.href}
            data-testid={notice.action.testId}
            className="inline-flex h-9 shrink-0 items-center rounded-md border border-current/30 bg-panel px-3 text-sm font-semibold hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-sm:h-11"
          >
            {notice.action.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}

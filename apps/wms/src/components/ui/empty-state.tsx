import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateAction {
  readonly title: string;
  readonly description?: string;
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly href?: string;
  readonly onClick?: () => void;
}

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly icon?: React.ComponentType<{ className?: string }>;
  /** Primary CTA (a Button) under the copy. */
  readonly action?: React.ReactNode;
  /** CTA cards ("Create order", "Import file", …). */
  readonly cards?: readonly EmptyStateAction[];
  readonly compact?: boolean;
  readonly className?: string;
}

function ActionCard({ card }: { readonly card: EmptyStateAction }) {
  const Icon = card.icon;
  const classes =
    'group flex w-full items-center gap-3 rounded-lg border border-border-subtle bg-panel px-4 py-3 text-left transition-[border-color,box-shadow] hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30 active:bg-surface-sunken';
  const inner = (
    <>
      {Icon ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-fg-secondary">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{card.title}</span>
        {card.description ? (
          <span className="mt-0.5 block text-xs leading-4 text-secondary">{card.description}</span>
        ) : null}
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
        aria-hidden
      />
    </>
  );
  if (card.href)
    return (
      <Link href={card.href} className={classes}>
        {inner}
      </Link>
    );
  return (
    <button type="button" onClick={card.onClick} className={classes}>
      {inner}
    </button>
  );
}

/** Grid of CTA cards (empty states, wizard success "What can you do next?"). */
export function ActionCards({
  cards,
  className,
}: {
  readonly cards: readonly EmptyStateAction[];
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'grid w-full max-w-[640px] gap-2.5',
        cards.length >= 3 ? 'sm:grid-cols-3' : cards.length > 1 ? 'sm:grid-cols-2' : '',
        className,
      )}
    >
      {cards.map((card) => (
        <ActionCard key={card.title} card={card} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  cards,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-muted text-fg-muted',
          compact ? 'h-10 w-10' : 'h-14 w-14',
        )}
      >
        <Icon className={compact ? 'h-5 w-5' : 'h-7 w-7'} aria-hidden />
      </span>
      <h3 className={cn('mt-3 font-semibold text-foreground', compact ? 'text-base' : 'text-md')}>{title}</h3>
      {description ? <p className="mt-1 max-w-[420px] text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
      {cards?.length ? <ActionCards cards={cards} className="mt-5" /> : null}
    </div>
  );
}

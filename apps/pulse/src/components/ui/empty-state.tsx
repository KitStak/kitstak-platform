import type { ReactNode } from 'react';
import { cn } from './cn';
import { Illustration, type IllustrationName } from './illustrations';

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly illustration?: IllustrationName;
  /** Custom visual instead of a built-in illustration. */
  readonly visual?: ReactNode;
  /** Primary + secondary actions. */
  readonly actions?: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  /** Heading tag for the title. Use `h1` when the empty state is the whole page (a 404). */
  readonly titleAs?: 'h1' | 'h2' | 'h3';
  readonly className?: string;
}

/** Centered illustration, message and a single clear call to action. */
export function EmptyState({
  title,
  description,
  illustration = 'board',
  visual,
  actions,
  size = 'md',
  titleAs: Title = 'h3',
  className,
}: EmptyStateProps) {
  const art = size === 'sm' ? 96 : size === 'lg' ? 200 : 152;
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      {visual ?? <Illustration name={illustration} size={art} className="animate-fade-in" />}
      <div className="flex max-w-sm flex-col gap-1">
        <Title className={cn('font-semibold text-fg', size === 'sm' ? 'text-base' : 'text-md')}>{title}</Title>
        {description ? (
          <p className={cn('text-fg-muted', 'text-sm')}>{description}</p>
        ) : null}
      </div>
      {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

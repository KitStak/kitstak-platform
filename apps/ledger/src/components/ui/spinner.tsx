import { cn } from './cn';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_PX: Readonly<Record<SpinnerSize, number>> = { xs: 12, sm: 16, md: 20, lg: 32 };

export interface SpinnerProps {
  readonly size?: SpinnerSize;
  readonly className?: string;
  /** Accessible label. Pass `null` when a parent already announces the busy state. */
  readonly label?: string | null;
}

/** Indeterminate circular spinner that inherits `currentColor`. */
export function Spinner({ size = 'sm', className, label = 'Loading' }: SpinnerProps) {
  const px = SIZE_PX[size];
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={cn('inline-flex shrink-0', className)}
      style={{ width: px, height: px }}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-full animate-spin">
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
        <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

import { cn } from './cn';

/** A loading placeholder block. It pulses, except under reduced motion. */
export function Skeleton({ className }: { readonly className?: string }) {
  return <span aria-hidden className={cn('block animate-pulse rounded-md bg-skeleton motion-reduce:animate-none', className)} />;
}

import type { ReactNode } from 'react';
import { cn } from './cn';

/** Keyboard key chip (CRM visual language: sunken chip with a hairline border). */
export function Kbd({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-default',
        'bg-sunken px-1 font-sans text-2xs font-semibold text-fg-secondary',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

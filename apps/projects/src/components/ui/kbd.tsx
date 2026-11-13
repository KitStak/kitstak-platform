import type { ReactNode } from 'react';
import { cn } from './cn';

export interface KbdProps {
  readonly children: ReactNode;
  readonly tone?: 'default' | 'inverse';
  readonly className?: string;
}

/** Keyboard key cap. */
export function Kbd({ children, tone = 'default', className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs px-1 font-sans text-2xs font-semibold',
        tone === 'default'
          ? 'border border-border-default border-b-2 bg-panel text-fg-secondary'
          : 'bg-white/15 text-fg-inverse',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Platform-aware modifier symbol: ⌘ on Apple platforms, Ctrl elsewhere. */
export function modKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl';
}

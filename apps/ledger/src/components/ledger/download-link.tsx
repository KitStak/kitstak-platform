'use client';
import type { ReactNode } from 'react';
import { buttonVariants, type ButtonSize, type ButtonVariant } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

/** A file download that looks like a Button (a plain link, so the browser saves the file). */
export function DownloadLink({ href, children, variant = 'secondary', size = 'md', icon, testId }: { readonly href: string; readonly children: ReactNode; readonly variant?: ButtonVariant; readonly size?: ButtonSize; readonly icon?: ReactNode; readonly testId?: string }) {
  return (
    <a href={href} download data-testid={testId} className={cn(buttonVariants({ variant, size }), 'no-underline')}>
      {icon}
      {children}
    </a>
  );
}

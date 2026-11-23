'use client';
import { useSelectedLayoutSegments } from 'next/navigation';
import type { ReactNode } from 'react';
import { KITSTAK_SITE_URL } from '@kitstak/ui/logo';
import { cn } from '@/components/ui';
import { Logo } from '@/features/shell/logo';
import { ThemeToggle } from '@/features/shell/theme-toggle';
import type { LegalUrls } from './legal-line';

const FOOT_LINK =
  'rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function Footer({ legal, year, className }: { readonly legal: LegalUrls; readonly year: number; readonly className?: string }) {
  return (
    <footer className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-fg-muted', className)}>
      <span>© {year} KitStak</span>
      <nav aria-label="Legal" className="flex items-center gap-4">
        <a href={legal.terms} target="_blank" rel="noopener" className={FOOT_LINK}>
          Terms
        </a>
        <a href={legal.privacy} target="_blank" rel="noopener" className={FOOT_LINK}>
          Privacy
        </a>
      </nav>
    </footer>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between gap-3">
      <a
        href={KITSTAK_SITE_URL}
        aria-label="KitStak website"
        className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
      >
        <Logo size={30} />
      </a>
      <ThemeToggle className="size-10" />
    </header>
  );
}

export interface AuthShellProps {
  readonly children: ReactNode;
  readonly hero: ReactNode;
  readonly legal: LegalUrls;
  readonly year: number;
}

export function AuthShell({ children, hero, legal, year }: AuthShellProps) {
  const segments = useSelectedLayoutSegments();
  const wide = segments[0] === 'signup' && segments[1] === 'plan';

  if (wide) {
    return (
      <div className="flex min-h-dvh flex-col bg-app">
        <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col px-4 py-5 sm:px-8 sm:py-6">
          <Header />
          <main className="flex-1 py-6 sm:py-10">{children}</main>
          <Footer legal={legal} year={year} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh bg-panel lg:grid-cols-[minmax(480px,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-w-0 flex-col px-5 py-5 sm:px-12 sm:py-6">
        <Header />
        {/*
          Every auth screen starts at the same height under the logo, so a short form (sign in,
          forgot password) sits where a long one (signup) starts, above the phone keyboard, and
          moving between them never makes the page jump. Centering is only for wide and tall
          desktop screens, where the brand panel sits beside the form.
        */}
        <main className="flex flex-1 items-start justify-center py-8 sm:py-10 [@media(min-width:1024px)_and_(min-height:800px)]:items-center">
          <div className="w-full max-w-[400px] animate-fade-in motion-reduce:animate-none">{children}</div>
        </main>
        <Footer legal={legal} year={year} />
      </div>
      <aside className="auth-hero relative hidden overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-10 lg:p-12">
        {hero}
      </aside>
    </div>
  );
}

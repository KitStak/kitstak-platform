'use client';

import * as React from 'react';
import { DashboardLinkProvider } from '@kitstak/ui/dashboard';
import { ThemeHandoff } from '@kitstak/ui/theme-handoff';
import { QueryProvider } from '@/lib/query-client';
import { Toaster } from '@/components/ui/toaster';
import { DashboardNextLink } from './dashboard-link';

/** Sibling-app origins for the cross-app theme handoff; dev defaults match the dev ports. */
const SIBLING_APP_URLS = [
  process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300',
  process.env.NEXT_PUBLIC_CRM_URL ?? 'http://localhost:3100',
  process.env.NEXT_PUBLIC_PROJECTS_URL ?? 'http://localhost:3400',
  process.env.NEXT_PUBLIC_PULSE_URL ?? 'http://localhost:3500',
];

/** Client providers mounted once in the root layout: TanStack Query, dashboard links (next/link) and the toast stack. */
export function AppProviders({ children }: { readonly children: React.ReactNode }) {
  return (
    <QueryProvider>
      {/* Carries the stored theme on links into Portal/CRM (stores are per origin). */}
      <ThemeHandoff appUrls={SIBLING_APP_URLS} />
      <DashboardLinkProvider component={DashboardNextLink}>{children}</DashboardLinkProvider>
      <Toaster />
    </QueryProvider>
  );
}

'use client';

import * as React from 'react';
import { QueryProvider } from '@/lib/query-client';
import { Toaster } from '@/components/ui/toaster';

/** Client providers mounted once in the root layout: TanStack Query + the toast stack. */
export function AppProviders({ children }: { readonly children: React.ReactNode }) {
  return (
    <QueryProvider>
      {children}
      <Toaster />
    </QueryProvider>
  );
}

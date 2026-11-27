'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api';
import { ThemeHandoff } from '@kitstak/ui/theme-handoff';
import { DashboardLinkProvider, type DashLinkProps } from '@kitstak/ui/dashboard';
import { Toaster, TooltipProvider, toast } from '@/components/ui';
import { ThemeProvider, useTheme } from '@/features/shell/theme';

/** Sibling-app origins for the cross-app theme handoff; dev defaults match the dev ports. */
const SIBLING_APP_URLS = [
  process.env.NEXT_PUBLIC_PORTAL_URL ?? 'http://localhost:3300',
  process.env.NEXT_PUBLIC_WMS_URL ?? 'http://localhost:3000',
  process.env.NEXT_PUBLIC_PROJECTS_URL ?? 'http://localhost:3400',
  process.env.NEXT_PUBLIC_PULSE_URL ?? 'http://localhost:3500',
];

const MAX_RETRIES = 2;

/** Retry network/5xx failures only; 4xx responses are deterministic. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (error instanceof ApiClientError) {
    return error.code === 'NETWORK_ERROR' || error.status >= 500 || error.status === 429;
  }
  return true;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
    mutationCache: new MutationCache({
      // Mutations that do not handle their own errors still surface a toast.
      onError: (error, _variables, _context, mutation) => {
        if (mutation.options.onError) return;
        const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
        toast.error("Couldn't save your change", message);
      },
    }),
  });
}

/** Dashboard pieces (tiles, rows, section actions) navigate client side through next/link. */
function DashboardNextLink({ href, children, ...rest }: DashLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} />;
}

export function Providers({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400} skipDelayDuration={200}>
          {/* Carries the stored theme on links into Portal/WMS (stores are per origin). */}
          <ThemeHandoff appUrls={SIBLING_APP_URLS} />
          <DashboardLinkProvider component={DashboardNextLink}>{children}</DashboardLinkProvider>
          <ThemedToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

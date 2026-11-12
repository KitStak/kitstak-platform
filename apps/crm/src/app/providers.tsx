'use client';
import { useState, type ReactNode } from 'react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api';
import { Toaster, TooltipProvider, toast } from '@/components/ui';
import { ThemeProvider, useTheme } from '@/features/shell/theme';

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
          {children}
          <ThemedToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

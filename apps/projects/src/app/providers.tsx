'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeHandoff } from '@kitstak/ui/theme-handoff';
import { Toaster, TooltipProvider, toast } from '@/components/ui';
import { ApiClientError } from '@/lib/api-client';

const MAX_RETRIES = 2;

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (error instanceof ApiClientError) return error.code === 'NETWORK_ERROR' || error.status >= 500 || error.status === 429;
  return true;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.options.onError) return;
        toast.error("Couldn't save your change", error instanceof Error ? error.message : 'Please try again.');
      },
    }),
  });
}

/** Resolved light/dark from the `data-theme` attribute (set before paint by THEME_INIT_SCRIPT). */
function useResolvedTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function Providers({ siblingUrls, children }: { readonly siblingUrls: readonly string[]; readonly children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const theme = useResolvedTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400} skipDelayDuration={200}>
        {/* Carries the stored theme on links into Portal / CRM / WMS (stores are per origin). */}
        <ThemeHandoff appUrls={siblingUrls} />
        {children}
        <Toaster theme={theme} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

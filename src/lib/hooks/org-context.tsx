'use client';

/**
 * Active organization for API hooks. Mount `<OrgProvider orgId=...>` in the authenticated
 * app shell (`(app)/[orgSlug]/layout`); every hook in `src/lib/hooks` reads it.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createApi, type KitstakApi } from '@/lib/api';

interface OrgContextValue {
  readonly orgId: string;
  readonly api: KitstakApi;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ orgId, children }: { readonly orgId: string; readonly children: ReactNode }) {
  const value = useMemo(() => ({ orgId, api: createApi(orgId) }), [orgId]);
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg() must be used inside <OrgProvider>');
  return value;
}

export function useOrgId(): string {
  return useOrg().orgId;
}

export function useApi(): KitstakApi {
  return useOrg().api;
}

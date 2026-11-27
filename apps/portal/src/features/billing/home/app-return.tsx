'use client';
import { useEffect } from 'react';
import { saveAppReturn } from '@/lib/app-return';

/**
 * A person arrived from an app to fix something (`/billing?fix=payment&from=crm`). The app is
 * remembered for this tab, so the line that confirms the fix can offer "Back to CRM" after the
 * card page. Renders nothing.
 */
export function RememberAppReturn({ from, returnPath }: { readonly from: string; readonly returnPath: string | null }) {
  useEffect(() => {
    saveAppReturn(from, returnPath);
  }, [from, returnPath]);
  return null;
}

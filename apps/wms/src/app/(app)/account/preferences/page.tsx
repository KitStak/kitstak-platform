import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAppDb } from '@/server/api/db';
import { getAuthContext } from '@/server/auth/context';
import { loadAccountPreferences } from '@/server/account/account-data';
import { accountTimezone } from '@/server/repositories/users-account';
import { timezoneLabel } from '@/lib/grid-defs/admin/account';
import { PageHeader } from '@/components/layout/page-header';
import { AccountShell } from '@/components/layout/account/account-shell';
import { AccountPreferencesForm } from '@/components/admin/account/preferences-form';
import { SkeletonText } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Preferences' };

const ROUTE = '/account/preferences';

async function PreferencesBody() {
  const auth = await getAuthContext();
  if (!auth) redirect(`/login?next=${encodeURIComponent(ROUTE)}`);
  const db = await getAppDb();
  const prefs = await loadAccountPreferences(db, auth.user.id);
  const tz = await accountTimezone(db, auth, prefs.defaultWarehouseId);
  return (
    <AccountPreferencesForm
      initial={{
        dateFormat: prefs.dateFormat,
        timeFormat: prefs.timeFormat,
        numberFormat: prefs.numberFormat,
      }}
      timezone={timezoneLabel(tz.timezone)}
      warehouse={tz.warehouse}
    />
  );
}

/** `/account/preferences` — date, time and number formats (every signed-in user). */
export default function PreferencesPage() {
  return (
    <>
      <PageHeader
        title="Preferences"
        helper="Choose your date, time and number formats. They apply right away across every grid and summary."
      />
      <AccountShell
        active="preferences"
        title="Preferences"
        description="The time zone comes from your warehouse."
      >
        <Suspense fallback={<SkeletonText lines={5} />}>
          <PreferencesBody />
        </Suspense>
      </AccountShell>
    </>
  );
}

import 'server-only';
import { Download } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { BlockedPage } from '@/features/people/blocked';
import { personFormOptions } from '@/server/domain/people';
import { pageFor } from '@/server/page';
import { arrivesIn } from '@/lib/pages';
import { PeopleExport } from './export-view';

const LATER = [
  { name: 'Hours and punches', phase: 4 as const },
  { name: 'Time off balances', phase: 5 as const },
  { name: 'Certifications and skills', phase: 6 as const },
  { name: 'Plan inputs', phase: 7 as const },
];

/** `/export` (docs/crew/SPEC.md 6.1): every stream in its template columns. People works now. */
export async function ExportPage() {
  const { ctx, can, locked, access } = await pageFor('/export');
  if (locked) return null;
  if (!can('export:run')) return <BlockedPage title="Export" role={access.role} />;
  const options = await personFormOptions(ctx);
  return (
    <Page title="Export" icon={<Download aria-hidden className="size-6 text-icon" />} subtitle="Download your Crew data as CSV files that open in Excel.">
      <div className="flex flex-col gap-4">
        <PeopleExport sites={options.sites} canSeePay={access.canSeePay} canSeePrivate={access.canSeePrivate} />
        <Panel title="More files">
          <ul className="grid gap-2 sm:grid-cols-4">
            {LATER.map((stream) => (
              <li key={stream.name} className="rounded-lg border border-border-subtle bg-sunken p-3">
                <p className="text-sm font-medium text-fg">{stream.name}</p>
                <p className="text-xs text-fg-muted">{arrivesIn(stream.phase)}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}

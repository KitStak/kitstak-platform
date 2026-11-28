import 'server-only';
import { UserPlus } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { personFormOptions } from '@/server/domain/people';
import { pageFor } from '@/server/page';
import { routes } from '@/lib/routes';
import { BlockedPage } from './blocked';
import { PersonForm } from './person-form';

/** `/people/new` (docs/crew/SPEC.md 6.1): one form, then "Print PIN slip". */
export async function NewPersonPage() {
  const { ctx, can, locked, access } = await pageFor('/people/new');
  if (locked) return null;
  if (!can('person:manage')) return <BlockedPage title="Add a person" role={access.role} />;
  const options = await personFormOptions(ctx);
  return (
    <Page title="Add a person" breadcrumbs={[{ label: 'People', href: routes.people() }, { label: 'Add a person' }]} icon={<UserPlus aria-hidden className="size-6 text-icon" />} subtitle="Temps get a number from Crew when you leave it empty. A PIN slip comes after you save." width="narrow">
      <PersonForm person={null} options={options} canSeePrivate={access.canSeePrivate} canManagePay={can('pay:manage')} />
    </Page>
  );
}

import type { Metadata } from 'next';
import { NewProjectWizard } from '@/features/projects';
import { pageContext } from '@/server/page';

export const metadata: Metadata = { title: 'New project' };

const str = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' && value ? value : undefined);

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageContext('/projects/new');
  const params = await searchParams;
  return (
    <NewProjectWizard
      prefill={{
        templateId: str(params.template),
        name: str(params.name),
        crmItemId: str(params.crmItem),
        customerId: str(params.customer),
        spaceId: str(params.space),
      }}
    />
  );
}

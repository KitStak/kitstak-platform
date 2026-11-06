import { redirect } from 'next/navigation';

interface CrmIndexProps {
  readonly params: Promise<{ orgSlug: string }>;
}

/** /crm lands on the pipeline cockpit. */
export default async function CrmIndex({ params }: CrmIndexProps) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/crm/pipeline`);
}

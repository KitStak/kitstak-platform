import { ClientByLinkPage } from '@/features/clients';

/** Deep link from a sibling app. See `ClientByLinkPage`. */
export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ClientByLinkPage searchParams={searchParams} />;
}

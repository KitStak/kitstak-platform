import { searchFull } from '@/server/domain';
import { pageContext } from '@/server/page';
import { parseSearchParams } from './search-params';
import { SearchView } from './search-view';

export async function SearchPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseSearchParams(await searchParams);
  const { ctx } = await pageContext(`/search${params.q ? `?q=${encodeURIComponent(params.q)}` : ''}`);
  const initial = params.q ? await searchFull(ctx, params.q, params) : null;
  return <SearchView initialParams={params} initial={initial} />;
}

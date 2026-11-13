import { listNotifications } from '@/server/domain';
import { pageContext } from '@/server/page';
import { parseInboxFilter } from './inbox-filter';
import { InboxView } from './inbox-view';

export async function InboxPage({ filter }: { readonly filter?: string | string[] }) {
  const { ctx } = await pageContext('/inbox');
  const initialFilter = parseInboxFilter(filter);
  return (
    <InboxView initialFilter={initialFilter} initial={await listNotifications(ctx, { filter: initialFilter })} />
  );
}

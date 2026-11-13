import { listNotifications } from '@/server/domain';
import { pageContext } from '@/server/page';
import { InboxView } from './inbox-view';

export async function InboxPage() {
  const { ctx } = await pageContext('/inbox');
  return <InboxView initial={await listNotifications(ctx)} />;
}

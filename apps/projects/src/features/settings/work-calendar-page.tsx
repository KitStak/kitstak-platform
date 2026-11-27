/** Server entry for /settings/calendar (docs/programs/SPEC.md 5.1, 5.19). */
import 'server-only';
import { getOrgCalendar } from '@/server/domain/programs';
import { pageContext } from '@/server/page';
import { WorkCalendar } from './work-calendar';

export async function WorkCalendarPage() {
  const { ctx } = await pageContext('/settings/calendar');
  const calendar = await getOrgCalendar(ctx);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: calendar.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return <WorkCalendar initial={calendar} today={today} />;
}

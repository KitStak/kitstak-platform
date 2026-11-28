/**
 * Screenshot slots on /crew. Every `file` is null until the Crew app exists and its screens are
 * captured. Put each picture in public/crew/shots/<slot>.webp and fill in `file`, `width`, `height`
 * and `alt`. While any slot is empty, CREW_IS_LIVE cannot be turned on (src/lib/go-live.test.ts).
 */
import type { AppShotSlot } from '../product/app-shot';

export const CREW_SHOTS = {
  hero: { screen: 'Weekly schedule', note: 'The week by site and area, with open shifts to fill.', file: null, rows: 7 },
  people: { screen: 'People', note: 'Everyone on the floor, with site, labor class and agency.', file: null },
  shifts: { screen: 'Schedule', note: 'Shift templates laid out across the week.', file: null, rows: 6 },
  kiosk: { screen: 'Kiosk', note: 'Big targets for a badge or a PIN at the door.', file: null, shape: 'narrow', rows: 4 },
  attendance: { screen: 'Who is here', note: 'Today’s board of who is on site, late or out.', file: null },
  skills: { screen: 'Skills', note: 'Certifications with their expiry dates, by person.', file: null },
  stack: { screen: 'Approved hours', note: 'A week of hours, ready to send to Pulse and payroll.', file: null },
} as const satisfies Readonly<Record<string, AppShotSlot>>;

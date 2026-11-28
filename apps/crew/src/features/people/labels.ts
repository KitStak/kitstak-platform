/** Words on screen for people fields (docs/crew/SPEC.md, words we use). Pure module, safe on server and client. */
export const KIND_LABELS: Readonly<Record<string, string>> = { employee: 'Employee', temp: 'Temp', seasonal: 'Seasonal' };
export const STATUS_LABELS: Readonly<Record<string, string>> = { active: 'Active', on_leave: 'On leave', ended: 'Ended' };
export const LANGUAGE_LABELS: Readonly<Record<string, string>> = { en: 'English', es: 'Spanish' };
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const STATUS_TONE: Readonly<Record<string, 'success' | 'warning' | 'neutral'>> = { active: 'success', on_leave: 'warning', ended: 'neutral' };

/** Dollars typed by a person ("19.50", "$19.5") as whole cents, or null when it is not a wage. */
export function dollarsToCents(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

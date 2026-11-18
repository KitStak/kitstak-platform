/**
 * KitStak copy never shows long dashes. Text that comes from seed data or sibling apps often
 * does, so it is rewritten for display and before it is cached:
 * - ranges read "to": "10pm–6am" and "Nov 20 – Jan 5" become "10pm to 6am" and "Nov 20 to Jan 5";
 * - any other en or em dash (or a spaced "--") becomes a middle dot: "Acme — Plan" reads "Acme · Plan".
 */
export function undash(text: string): string {
  if (!/[–—]|\s--\s/.test(text)) return text;
  return text
    .replace(/(\S)–(?=\S)/g, '$1 to ')
    .replace(/(\d)\s+–\s+(?=\w)/g, '$1 to ')
    .replace(/\s*[–—]\s*|\s+--\s+/g, ' · ');
}

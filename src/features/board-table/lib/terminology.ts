/** Item terminology helpers ("Deal" → "deals", "Opportunity" → "opportunities"). Pure. */

export function pluralize(noun: string): string {
  const word = noun.trim();
  if (!word) return 'items';
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** Singular or plural form for a count. */
export function plural(noun: string, count: number): string {
  return count === 1 ? noun : pluralize(noun);
}

/** "12 Deals" / "1 Deal". */
export function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${plural(noun, count)}`;
}

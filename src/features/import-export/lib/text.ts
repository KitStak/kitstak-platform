/** Header normalization and fuzzy name similarity for auto-mapping. */

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/e-mail/g, 'email')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function singular(word: string): string {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokens(value: string): string[] {
  return normalizeHeader(value).split(' ').filter(Boolean).map(singular);
}

/** Synonym groups: headers in one group map onto each other. */
const SYNONYMS: readonly (readonly string[])[] = [
  ['email', 'mail', 'email address', 'work email', 'business email', 'primary email'],
  ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone number', 'mobile phone', 'work phone'],
  ['company', 'account', 'organization', 'organisation', 'business', 'company name', 'account name', 'employer'],
  ['owner', 'assignee', 'assigned to', 'rep', 'sales rep', 'account owner', 'deal owner', 'lead owner', 'person'],
  ['status', 'stage', 'state', 'deal stage', 'lead status', 'pipeline stage'],
  ['value', 'amount', 'deal value', 'deal size', 'revenue', 'price', 'contract value', 'arr'],
  ['close date', 'expected close', 'expected close date', 'closing date', 'close'],
  ['website', 'url', 'web', 'site', 'domain', 'homepage'],
  ['title', 'job title', 'position', 'role'],
  ['notes', 'note', 'description', 'comments', 'comment', 'details'],
  ['address', 'location', 'street address', 'city'],
  ['country', 'nation', 'country code'],
  ['source', 'lead source', 'channel', 'origin'],
  ['tags', 'labels', 'keywords'],
  ['priority', 'urgency', 'importance'],
  ['name', 'full name', 'contact name', 'contact', 'lead name', 'deal name', 'item', 'item name', 'deal', 'lead'],
];

function synonymGroup(value: string): number {
  const normalized = tokens(value).join(' ');
  return SYNONYMS.findIndex((group) => group.some((entry) => tokens(entry).join(' ') === normalized));
}

/** Similarity (0–1) between a file header and a board column title. */
export function nameSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.length === 0 || right.length === 0) return 0;
  const l = left.join(' ');
  const r = right.join(' ');
  if (l === r) return 1;
  const group = synonymGroup(a);
  if (group >= 0 && group === synonymGroup(b)) return 0.92;
  if (l.replace(/ /g, '') === r.replace(/ /g, '')) return 0.95;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = [...leftSet].filter((token) => rightSet.has(token)).length;
  const jaccard = shared / new Set([...leftSet, ...rightSet]).size;
  if (shared > 0 && (l.includes(r) || r.includes(l))) return Math.max(0.75, jaccard);
  return jaccard * 0.9;
}

/** True when a header is a typical "item name" column. */
export function isNameLike(header: string): boolean {
  const normalized = tokens(header).join(' ');
  return /^(name|full name|contact name|lead name|deal name|deal|lead|item|item name|title|company name|account name|company|subject|task|opportunity|opportunity name|project|project name)$/.test(
    normalized,
  );
}

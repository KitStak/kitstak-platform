/**
 * Demo product images (M09). The realistic seed catalog (Apex, Voltbyte, Copperline…) ships
 * without merchant image URLs, which leaves the grid image column, listings and detail header
 * on placeholders in a demo. These are small, deterministic product illustrations (one per
 * product kind, tinted by colourway / brand), served same-origin by
 * `GET /api/products/demo-image/<kind>-<hex>.svg` so they pass the app CSP (`img-src 'self'`).
 *
 * Pure: the route renders `renderDemoImage`, the seed / owner script stores `demoImageUrl`.
 * The SVG is static markup built from a fixed shape table and a validated hex colour, so a
 * stored URL can never inject markup.
 */

export const DEMO_IMAGE_PREFIX = '/api/products/demo-image/';

export const DEMO_IMAGE_KINDS = [
  'tee',
  'jacket',
  'socks',
  'cap',
  'band',
  'cable',
  'charger',
  'powerbank',
  'hub',
  'earbuds',
  'speaker',
  'keyboard',
  'mouse',
  'stand',
  'webcam',
  'phone-case',
  'screen',
  'grip',
  'mount',
  'coffee-bag',
  'pods',
  'instant',
  'filter',
  'mug',
  'grinder',
  'mailer',
  'bubble-bag',
  'sleeve',
  'box',
  'kit',
  'widget',
] as const;
export type DemoImageKind = (typeof DEMO_IMAGE_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(DEMO_IMAGE_KINDS);
const KEY_RE = /^([a-z]+(?:-[a-z]+)*)-([0-9a-f]{6})\.svg$/;
/** A stored demo-image URL (same-origin path). Accepted by the product image-URL rule. */
export const DEMO_IMAGE_URL_RE = /^\/api\/products\/demo-image\/[a-z]+(?:-[a-z]+)*-[0-9a-f]{6}\.svg$/;

export function isDemoImageUrl(v: string): boolean {
  return DEMO_IMAGE_URL_RE.test(v) && parseDemoImageKey(v.slice(DEMO_IMAGE_PREFIX.length)) !== null;
}

/** `tee-1f2937.svg` → `{ kind: "tee", hex: "1f2937" }`; anything else → null. */
export function parseDemoImageKey(key: string): { kind: DemoImageKind; hex: string } | null {
  const m = KEY_RE.exec(key);
  if (!m?.[1] || !m[2] || !KIND_SET.has(m[1])) return null;
  return { kind: m[1] as DemoImageKind, hex: m[2] };
}

/** Colourway tokens in the SKU win; then the brand (client / SKU prefix) colour. */
const COLOURWAYS: readonly (readonly [RegExp, string])[] = [
  [/-BLK\b|-BLK-/, '1f2937'],
  [/-WHT\b|-WHT-/, 'e5e7eb'],
  [/-NVY\b|-NVY-/, '1e3a5f'],
  [/-OLV\b|-OLV-/, '556b2f'],
  [/-GRY\b|-GRY-/, '9ca3af'],
  [/-KHK\b|-KHK-/, 'b8a27a'],
  [/-ESP-/, '3b2418'],
  [/-DRK-/, '2b1b12'],
  [/-MED-/, '8a5a35'],
  [/-DEC-/, '4d6b53'],
  [/-HSE-/, '7a4b2a'],
  [/-SNG-/, 'a0522d'],
  [/-CLD-/, '1d4e89'],
];
const BRAND_COLOURS: Readonly<Record<string, string>> = {
  APX: '1f2937',
  SMT: '3f6212',
  BLB: '334155',
  CPL: 'b45309',
  HRB: '7c4a2d',
  NOVA: '2563eb',
  NVF: '2563eb',
  PXP: '7c3aed',
  VLT: '0f766e',
  MLT: '64748b',
};
const DEFAULT_COLOUR = '475569';

export function demoImageColour(sku: string): string {
  const s = sku.toUpperCase();
  for (const [re, hex] of COLOURWAYS) if (re.test(s)) return hex;
  return BRAND_COLOURS[s.split('-')[0] ?? ''] ?? DEFAULT_COLOUR;
}

/** Product kind from the SKU tokens (seed naming), falling back to the category. */
export function demoImageKind(sku: string, category?: string | null): DemoImageKind {
  const s = sku.toUpperCase();
  const has = (...t: string[]) => t.some((x) => s.includes(x));
  if (has('-KIT-')) return 'kit';
  if (has('-PKG-'))
    return has('POLY') ? 'mailer' : has('ASB', 'BUBBLE') ? 'bubble-bag' : has('SLEEVE') ? 'sleeve' : 'box';
  if (has('-TEE-')) return 'tee';
  if (has('-JKT-', '-HOOD')) return 'jacket';
  if (has('-SOCK')) return 'socks';
  if (has('-CAP-')) return 'cap';
  if (has('-BND-')) return 'band';
  if (has('-CBL-')) return 'cable';
  if (has('-PWB-')) return 'powerbank';
  if (has('-CHG-')) return 'charger';
  if (has('-HUB-')) return 'hub';
  if (has('-EBD-')) return 'earbuds';
  if (has('-SPK-')) return 'speaker';
  if (has('-KBD-')) return 'keyboard';
  if (has('-MSE-')) return 'mouse';
  if (has('-STAND-')) return 'stand';
  if (has('-WCM-')) return 'webcam';
  if (has('-CASE-')) return 'phone-case';
  if (has('-SCR-')) return 'screen';
  if (has('-GRIP-')) return 'grip';
  if (has('-MNT-')) return 'mount';
  if (has('-PODS')) return 'pods';
  if (has('-INST')) return 'instant';
  if (has('-FLTR')) return 'filter';
  if (has('-MUG')) return 'mug';
  if (has('-GRND')) return 'grinder';
  if (has('-BAG-')) return 'coffee-bag';
  const c = (category ?? '').toLowerCase();
  if (c.includes('packag')) return 'box';
  if (c.includes('apparel')) return 'tee';
  if (c.includes('coffee')) return 'coffee-bag';
  return 'widget';
}

export function demoImageUrl(sku: string, category?: string | null): string {
  return `${DEMO_IMAGE_PREFIX}${demoImageKind(sku, category)}-${demoImageColour(sku)}.svg`;
}

/* ------------------------------------------------------------------ rendering */

function channel(hex: string, i: number): number {
  return Number.parseInt(hex.slice(i, i + 2), 16);
}

/** Mixes the colour toward black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const t = amount < 0 ? 0 : 255;
  const p = Math.min(1, Math.abs(amount));
  return [0, 2, 4]
    .map((i) =>
      Math.round(channel(hex, i) + (t - channel(hex, i)) * p)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
}

function isLight(hex: string): boolean {
  return 0.299 * channel(hex, 0) + 0.587 * channel(hex, 2) + 0.114 * channel(hex, 4) > 170;
}

/** Shape markup per kind on a 96×96 canvas. `f` fill, `d` darker outline, `l` lighter accent. */
const SHAPES: Readonly<Record<DemoImageKind, (f: string, d: string, l: string) => string>> = {
  tee: (f, d) =>
    `<path d="M34 20 L22 26 L12 40 L22 46 L26 41 L26 78 L70 78 L70 41 L74 46 L84 40 L74 26 L62 20 Q48 30 34 20 Z" fill="#${f}" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/><path d="M38 21 Q48 27 58 21" fill="none" stroke="#${d}" stroke-width="2"/>`,
  jacket: (f, d) =>
    `<path d="M34 18 L22 24 L14 72 L24 74 L28 44 L28 80 L68 80 L68 44 L72 74 L82 72 L74 24 L62 18 L48 26 Z" fill="#${f}" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/><path d="M48 26 L48 80" stroke="#${d}" stroke-width="2"/><path d="M34 18 Q40 12 48 14 Q56 12 62 18" fill="#${f}" stroke="#${d}" stroke-width="2"/>`,
  socks: (f, d, l) =>
    `<path d="M36 14 L56 14 L56 54 L74 64 Q82 70 76 78 Q72 84 62 80 L38 68 Q32 64 34 56 Z" fill="#${f}" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/><rect x="36" y="14" width="20" height="8" fill="#${l}"/>`,
  cap: (f, d) =>
    `<path d="M18 58 Q20 26 50 24 Q78 26 78 58 Z" fill="#${f}" stroke="#${d}" stroke-width="2"/><path d="M14 58 L86 58 Q88 66 78 66 L22 66 Q12 66 14 58 Z" fill="#${d}"/><circle cx="48" cy="24" r="3" fill="#${d}"/>`,
  band: (f, d) =>
    `<ellipse cx="48" cy="50" rx="32" ry="18" fill="none" stroke="#${f}" stroke-width="10"/><ellipse cx="48" cy="50" rx="32" ry="18" fill="none" stroke="#${d}" stroke-width="1.5"/>`,
  cable: (f, d) =>
    `<path d="M24 70 Q24 30 48 30 Q72 30 72 50 Q72 64 56 64 Q42 64 42 52" fill="none" stroke="#${f}" stroke-width="5" stroke-linecap="round"/><rect x="16" y="68" width="16" height="14" rx="3" fill="#${d}"/><rect x="36" y="38" width="12" height="14" rx="3" fill="#${d}"/>`,
  charger: (f, d, l) =>
    `<rect x="26" y="28" width="44" height="48" rx="8" fill="#${f}" stroke="#${d}" stroke-width="2"/><rect x="36" y="16" width="6" height="14" rx="1" fill="#${d}"/><rect x="54" y="16" width="6" height="14" rx="1" fill="#${d}"/><rect x="40" y="56" width="16" height="6" rx="2" fill="#${l}"/>`,
  powerbank: (f, d, l) =>
    `<rect x="30" y="14" width="36" height="68" rx="8" fill="#${f}" stroke="#${d}" stroke-width="2"/>${[0, 1, 2, 3].map((i) => `<circle cx="${40 + i * 5}" cy="70" r="1.8" fill="#${l}"/>`).join('')}`,
  hub: (f, d, l) =>
    `<rect x="12" y="38" width="72" height="20" rx="6" fill="#${f}" stroke="#${d}" stroke-width="2"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${18 + i * 9}" y="45" width="6" height="6" rx="1" fill="#${l}"/>`).join('')}`,
  earbuds: (f, d, l) =>
    `<rect x="22" y="36" width="52" height="40" rx="18" fill="#${f}" stroke="#${d}" stroke-width="2"/><path d="M22 52 L74 52" stroke="#${d}" stroke-width="1.5"/><circle cx="36" cy="26" r="8" fill="#${l}" stroke="#${d}" stroke-width="2"/><circle cx="60" cy="26" r="8" fill="#${l}" stroke="#${d}" stroke-width="2"/>`,
  speaker: (f, d, l) =>
    `<rect x="26" y="14" width="44" height="68" rx="14" fill="#${f}" stroke="#${d}" stroke-width="2"/><circle cx="48" cy="56" r="13" fill="#${d}"/><circle cx="48" cy="56" r="5" fill="#${l}"/><circle cx="48" cy="30" r="5" fill="#${d}"/>`,
  keyboard: (f, d, l) =>
    `<rect x="10" y="32" width="76" height="32" rx="5" fill="#${f}" stroke="#${d}" stroke-width="2"/>${[0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5, 6, 7].map((c) => `<rect x="${15 + c * 8.6}" y="${37 + r * 8}" width="6.4" height="5.6" rx="1" fill="#${l}"/>`).join('')).join('')}`,
  mouse: (f, d, l) =>
    `<path d="M48 16 Q70 16 70 46 Q70 80 48 80 Q26 80 26 46 Q26 16 48 16 Z" fill="#${f}" stroke="#${d}" stroke-width="2"/><path d="M48 16 L48 40" stroke="#${d}" stroke-width="2"/><rect x="46" y="24" width="4" height="9" rx="2" fill="#${l}"/>`,
  stand: (f, d) =>
    `<path d="M16 74 L80 74 L70 34 L26 34 Z" fill="none" stroke="#${f}" stroke-width="5" stroke-linejoin="round"/><path d="M22 34 L74 30" stroke="#${d}" stroke-width="4" stroke-linecap="round"/>`,
  webcam: (f, d, l) =>
    `<rect x="20" y="28" width="56" height="30" rx="14" fill="#${f}" stroke="#${d}" stroke-width="2"/><circle cx="48" cy="43" r="10" fill="#${d}"/><circle cx="48" cy="43" r="4" fill="#${l}"/><path d="M40 58 L36 76 L60 76 L56 58" fill="#${d}"/>`,
  'phone-case': (f, d, l) =>
    `<rect x="28" y="12" width="40" height="72" rx="9" fill="#${f}" stroke="#${d}" stroke-width="2"/><rect x="33" y="17" width="16" height="16" rx="4" fill="#${d}"/><circle cx="38" cy="22" r="2.5" fill="#${l}"/><circle cx="44" cy="28" r="2.5" fill="#${l}"/>`,
  screen: (f, d) =>
    `<rect x="28" y="12" width="40" height="72" rx="9" fill="#${f}" fill-opacity="0.35" stroke="#${d}" stroke-width="2"/><path d="M36 24 L48 16 M36 40 L60 24" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`,
  grip: (f, d, l) =>
    `<circle cx="48" cy="48" r="28" fill="#${f}" stroke="#${d}" stroke-width="2"/><circle cx="48" cy="48" r="14" fill="#${l}" stroke="#${d}" stroke-width="2"/>`,
  mount: (f, d) =>
    `<rect x="34" y="14" width="28" height="22" rx="4" fill="none" stroke="#${f}" stroke-width="5"/><path d="M48 36 L48 58 L36 74" stroke="#${f}" stroke-width="6" stroke-linecap="round" fill="none"/><circle cx="34" cy="76" r="8" fill="#${d}"/>`,
  'coffee-bag': (f, d, l) =>
    `<path d="M28 22 L68 22 L74 82 L22 82 Z" fill="#${f}" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/><rect x="28" y="14" width="40" height="10" fill="#${d}"/><rect x="32" y="44" width="32" height="22" rx="2" fill="#${l}"/><circle cx="48" cy="55" r="5" fill="#${d}"/>`,
  pods: (f, d, l) =>
    `<rect x="16" y="30" width="64" height="44" rx="4" fill="#${f}" stroke="#${d}" stroke-width="2"/>${[0, 1, 2].map((c) => `<circle cx="${32 + c * 16}" cy="52" r="6" fill="#${l}" stroke="#${d}" stroke-width="1.5"/>`).join('')}`,
  instant: (f, d, l) =>
    `<rect x="30" y="18" width="36" height="62" rx="4" fill="#${f}" stroke="#${d}" stroke-width="2"/><rect x="28" y="14" width="40" height="8" rx="2" fill="#${d}"/><rect x="34" y="40" width="28" height="18" rx="2" fill="#${l}"/>`,
  filter: (f, d) =>
    `<path d="M20 26 L76 26 L58 76 L38 76 Z" fill="#${f}" fill-opacity="0.35" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/><path d="M28 40 L68 40" stroke="#${d}" stroke-width="1.5" opacity="0.6"/>`,
  mug: (f, d, l) =>
    `<path d="M22 26 L62 26 L60 76 Q60 80 56 80 L28 80 Q24 80 24 76 Z" fill="#${f}" stroke="#${d}" stroke-width="2"/><path d="M62 38 Q78 38 76 52 Q74 64 60 64" fill="none" stroke="#${d}" stroke-width="5"/><rect x="30" y="44" width="24" height="12" rx="2" fill="#${l}"/>`,
  grinder: (f, d, l) =>
    `<path d="M32 14 L64 14 L58 34 L38 34 Z" fill="#${l}" stroke="#${d}" stroke-width="2"/><rect x="30" y="34" width="36" height="48" rx="5" fill="#${f}" stroke="#${d}" stroke-width="2"/><circle cx="48" cy="56" r="7" fill="#${d}"/>`,
  mailer: (f, d) =>
    `<rect x="14" y="24" width="68" height="50" rx="3" fill="#${f}" stroke="#${d}" stroke-width="2"/><path d="M14 30 L48 52 L82 30" fill="none" stroke="#${d}" stroke-width="2"/>`,
  'bubble-bag': (f, d) =>
    `<rect x="20" y="20" width="56" height="58" rx="3" fill="#${f}" fill-opacity="0.45" stroke="#${d}" stroke-width="2"/>${[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => `<circle cx="${28 + c * 10}" cy="${30 + r * 10}" r="3" fill="#ffffff" opacity="0.8"/>`).join('')).join('')}`,
  sleeve: (f, d, l) =>
    `<path d="M14 34 L82 34 L82 64 L14 64 Z" fill="#${f}" stroke="#${d}" stroke-width="2"/><path d="M14 40 L82 40 M14 58 L82 58" stroke="#${l}" stroke-width="2"/>`,
  box: (f, d, l) =>
    `<path d="M48 16 L80 30 L48 44 L16 30 Z" fill="#${l}" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/><path d="M16 30 L48 44 L48 82 L16 68 Z" fill="#${f}" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/><path d="M80 30 L48 44 L48 82 L80 68 Z" fill="#${d}" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/>`,
  kit: (f, d, l) =>
    `<rect x="18" y="38" width="60" height="42" rx="3" fill="#${f}" stroke="#${d}" stroke-width="2"/><rect x="14" y="28" width="68" height="14" rx="3" fill="#${f}" stroke="#${d}" stroke-width="2"/><rect x="44" y="28" width="8" height="52" fill="#${l}"/><path d="M48 28 Q36 12 30 20 Q26 28 48 28 Q70 28 66 20 Q60 12 48 28 Z" fill="#${l}" stroke="#${d}" stroke-width="1.5"/>`,
  widget: (f, d, l) =>
    `<path d="M48 14 L78 31 L78 65 L48 82 L18 65 L18 31 Z" fill="#${f}" stroke="#${d}" stroke-width="2" stroke-linejoin="round"/><circle cx="48" cy="48" r="11" fill="#${l}" stroke="#${d}" stroke-width="2"/>`,
};

/** Complete SVG document for a validated kind + hex. */
export function renderDemoImage(kind: DemoImageKind, hex: string): string {
  if (!/^[0-9a-f]{6}$/.test(hex)) throw new Error('invalid colour');
  const light = isLight(hex);
  const d = shade(hex, light ? -0.35 : -0.3);
  const l = light ? shade(hex, -0.12) : shade(hex, 0.55);
  const bg = light ? 'dfe3e8' : 'f3f4f6';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><rect width="96" height="96" rx="10" fill="#${bg}"/><ellipse cx="48" cy="86" rx="30" ry="4" fill="#000000" opacity="0.07"/>${SHAPES[kind](hex, d, l)}</svg>`;
}

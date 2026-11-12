/**
 * Distinct brand tiles for the integration hubs and grid cells. KitStaks draws these itself in each
 * brand's colour; no third-party trademark artwork ships (catalog policy in `lib/channel-catalog`).
 * Each tile has its own shape, so two brands never read the same at a glance (WooCommerce vs Walmart,
 * Amazon vs Amazon FBA). Unknown keys fall back to the catalog monogram.
 */

const tile = (bg: string, inner: string, fg = '#fff') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img"><rect width="48" height="48" rx="10" fill="${bg}"/><g fill="${fg}" stroke="${fg}">${inner}</g></svg>`;

const word = (text: string, size: number, o: { y?: number; weight?: number; fill?: string } = {}) =>
  `<text x="24" y="${o.y ?? 24}" dy=".35em" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="${o.weight ?? 800}" font-size="${size}" stroke="none"${o.fill ? ` fill="${o.fill}"` : ''}>${text}</text>`;

const smile = (y: number, color = '#FF9900') =>
  `<path d="M13 ${y} q11 7 22 0" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/><path d="M32 ${y - 2.5} l3.5 2.4 -3.8 1.6" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

const crosshair = `<circle cx="24" cy="24" r="11" fill="none" stroke-width="3"/><path d="M24 13v22M13 24h22" stroke-width="2"/>`;

const tiktokNote = (stroke: string, dx: number) =>
  `<path d="M26 12v17.5a5.5 5.5 0 1 1-5.5-5.5M26 12c0 4 3 7 7 7" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" transform="translate(${dx} ${dx})"/>`;

const BRAND_MARKS: Readonly<Record<string, string>> = {
  'channel:shopify': tile(
    '#5E8E3E',
    `<path d="M15 18h18l-2 19H17z" stroke="none"/><path d="M19.5 18v-2.5a4.5 4.5 0 0 1 9 0V18" fill="none" stroke-width="2.4"/>${word('S', 13, { y: 28, fill: '#5E8E3E' })}`,
  ),
  'channel:shipstation': tile('#84C225', crosshair),
  'channel:amazon': tile('#232F3E', `${word('a', 24, { y: 20 })}${smile(31)}`),
  'channel:amazon-fba': tile('#232F3E', `${word('FBA', 13, { y: 19 })}${smile(30)}`),
  'channel:woocommerce': tile(
    '#7F54B3',
    `<rect x="7" y="14" width="34" height="18" rx="5" stroke="none"/><path d="M20 32l-3 5 8-5z" stroke="none"/>${word('Woo', 12, { y: 23, fill: '#7F54B3' })}`,
  ),
  'channel:walmart': tile(
    '#0071CE',
    Array.from(
      { length: 6 },
      (_, i) =>
        `<rect x="22.4" y="9" width="3.2" height="11" rx="1.6" fill="#FFC220" stroke="none" transform="rotate(${i * 60} 24 24)"/>`,
    ).join(''),
  ),
  'channel:tiktok': tile(
    '#111111',
    `${tiktokNote('#25F4EE', -1.2)}${tiktokNote('#FE2C55', 1.2)}${tiktokNote('#fff', 0)}`,
  ),
  'channel:magento': tile(
    '#EE672F',
    `<path d="M12 34V17l12-7 12 7v17l-4 2V19l-8-4.5-8 4.5v17z" stroke="none"/><path d="M22 36V21l2-1 2 1v15l-2 1z" stroke="none"/>`,
  ),
  'channel:loop-returns': tile(
    '#1A1A1A',
    `<path d="M33 19a10 10 0 1 0 1 9" fill="none" stroke-width="3.2" stroke-linecap="round"/><path d="M34 12v8h-8" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  'channel:quickbooks-online': tile(
    '#2CA01C',
    `<circle cx="24" cy="24" r="13" stroke="none"/>${word('qb', 15, { fill: '#2CA01C' })}`,
  ),
  'channel:cartrover': tile(
    '#1F6FB2',
    `<path d="M10 14h5l4 15h15l3-10H17" fill="none" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="21" cy="34" r="2.4" stroke="none"/><circle cx="32" cy="34" r="2.4" stroke="none"/>`,
  ),
  'channel:squarespace': tile(
    '#222222',
    `<rect x="12" y="17" width="16" height="7" rx="3.5" fill="none" stroke-width="3" transform="rotate(-45 20 20.5)"/><rect x="20" y="24" width="16" height="7" rx="3.5" fill="none" stroke-width="3" transform="rotate(-45 28 27.5)"/>`,
  ),
  'channel:ebay': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img"><rect x=".5" y=".5" width="47" height="47" rx="10" fill="#fff" stroke="#E4E7EC"/><g font-family="Inter,Arial,sans-serif" font-weight="800" font-size="15"><text x="5" y="29" fill="#E53238">e</text><text x="14" y="29" fill="#0064D2">b</text><text x="23.5" y="29" fill="#F5AF02">a</text><text x="32.5" y="29" fill="#86B817">y</text></g></svg>`,
  'channel:bigcommerce': tile(
    '#121118',
    `${word('B', 22, { weight: 900 })}<path d="M30 12h6v6z" stroke="none"/>`,
  ),
  'channel:etsy': tile('#F1641E', word('Etsy', 15, { weight: 700 })),
  'carrier:shipstation': tile('#84C225', crosshair),
  'carrier:ups': tile(
    '#4B2E14',
    `<path d="M12 11h24v14c0 7-6 11-12 13-6-2-12-6-12-13z" fill="#FFB500" stroke="none"/>${word('ups', 11, { fill: '#4B2E14' })}`,
  ),
  'carrier:fedex': tile(
    '#4D148C',
    `${word('Fed', 12, { y: 19 })}${word('Ex', 12, { y: 31, fill: '#FF6600' })}`,
  ),
  'carrier:stamps-com': tile(
    '#1E4E9C',
    `<rect x="12" y="12" width="24" height="24" rx="2" fill="none" stroke-width="2" stroke-dasharray="3 2"/>${word('ST', 12)}`,
  ),
  'carrier:easypost': tile(
    '#1F4FBF',
    `<path d="M14 30l10-14 10 14z" fill="none" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="26" r="2.5" stroke="none"/>`,
  ),
  'carrier:techship': tile(
    '#0B3D5C',
    `<path d="M10 28h28l-5 6H15z" stroke="none"/><path d="M16 26V16h10l6 10" fill="none" stroke-width="2.4" stroke-linejoin="round"/>`,
  ),
  'carrier:custom-carrier': tile(
    '#475467',
    `<path d="M9 18h18v12H9zM27 22h7l4 4v4H27z" fill="none" stroke-width="2.4" stroke-linejoin="round"/><circle cx="15" cy="32" r="2.6" stroke="none"/><circle cx="32" cy="32" r="2.6" stroke="none"/>`,
  ),
  'carrier:ehub': tile(
    '#00A0DF',
    `<circle cx="24" cy="24" r="4" stroke="none"/>${[0, 72, 144, 216, 288].map((a) => `<g transform="rotate(${a} 24 24)"><path d="M24 20v-8" stroke-width="2.2"/><circle cx="24" cy="11" r="2.4" stroke="none"/></g>`).join('')}`,
  ),
  'carrier:shipium': tile(
    '#2D2A8C',
    `<path d="M14 32l10-18 10 18" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 26h12" stroke-width="2.4"/>`,
  ),
  'carrier:eshipper': tile(
    '#E2231A',
    `<path d="M24 9l3 7 6-3-2 7 6 1-6 5 2 3h-8v7h-2v-7h-8l2-3-6-5 6-1-2-7 6 3z" stroke="none"/>`,
  ),
  'carrier:buku': tile(
    '#00B2A9',
    `<rect x="12" y="14" width="24" height="20" rx="2" fill="none" stroke-width="2.6"/><path d="M12 21h24M24 14v7" stroke-width="2.4"/>`,
  ),
  'carrier:shippo': tile(
    '#1B3A57',
    `<path d="M11 27h26l-4 7H15z" stroke="none"/><path d="M24 12v13M24 12l8 10h-8" fill="none" stroke-width="2.4" stroke-linejoin="round"/>`,
  ),
  'carrier:idrive-logistics': tile(
    '#0E7C3A',
    `${word('iD', 17)}<path d="M13 34h22" stroke-width="2.4" stroke-linecap="round"/>`,
  ),
};

/** KitStaks-drawn brand tile for a catalog entry; falls back to the catalog's monogram SVG. */
export function brandMarkSvg(kind: 'channel' | 'carrier', key: string, fallback: string): string {
  return BRAND_MARKS[`${kind}:${key}`] ?? fallback;
}

/** Keys with a dedicated tile (used by the unit test that keeps every catalog entry distinct). */
export const BRAND_MARK_KEYS: readonly string[] = Object.keys(BRAND_MARKS);

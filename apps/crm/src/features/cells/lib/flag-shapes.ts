/**
 * Tiny vector flags (20×15 viewBox) for the countries in `countries.ts`, so flags render the
 * same on every OS (Windows has no flag emoji). Simplified for 16–20px display: emblems become
 * their dominant shape. Colors are each nation's official flag colors (heraldic data, not UI
 * palette, so they intentionally live here rather than in design tokens).
 */

export type FlagShape =
  | { readonly t: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly c: string }
  | { readonly t: 'circle'; readonly cx: number; readonly cy: number; readonly r: number; readonly c: string }
  | { readonly t: 'poly'; readonly p: string; readonly c: string }
  | { readonly t: 'line'; readonly d: string; readonly c: string; readonly w: number }
  /** A whole flag drawn (and clipped) into a sub-box: the union canton of AU / NZ. */
  | { readonly t: 'nest'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly shapes: readonly FlagShape[] };

const W = 20;
const H = 15;

const C = {
  red: '#d52b1e',
  white: '#ffffff',
  blue: '#0a3a8c',
  navy: '#012169',
  green: '#007a3d',
  yellow: '#fcd116',
  black: '#000000',
  orange: '#ff883e',
} as const;

function h(...colors: string[]): FlagShape[] {
  const band = H / colors.length;
  return colors.map((c, index) => ({ t: 'rect', x: 0, y: index * band, w: W, h: band + 0.05, c }));
}

function hw(parts: readonly (readonly [string, number])[]): FlagShape[] {
  const total = parts.reduce((sum, [, weight]) => sum + weight, 0);
  let y = 0;
  return parts.map(([c, weight]) => {
    const height = (weight / total) * H;
    const shape: FlagShape = { t: 'rect', x: 0, y, w: W, h: height + 0.05, c };
    y += height;
    return shape;
  });
}

function v(...colors: string[]): FlagShape[] {
  const band = W / colors.length;
  return colors.map((c, index) => ({ t: 'rect', x: index * band, y: 0, w: band + 0.05, h: H, c }));
}

function bg(c: string): FlagShape {
  return { t: 'rect', x: 0, y: 0, w: W, h: H, c };
}

/** 5-point star polygon. */
function star(cx: number, cy: number, r: number, c: string): FlagShape {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? r : r * 0.4;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return { t: 'poly', p: points.join(' '), c };
}

/** Nordic cross with the vertical bar offset toward the hoist. */
function nordic(field: string, cross: string, inner?: string): FlagShape[] {
  const shapes: FlagShape[] = [bg(field), { t: 'rect', x: 5.5, y: 0, w: 3, h: H, c: cross }, { t: 'rect', x: 0, y: 6, w: W, h: 3, c: cross }];
  if (inner) shapes.push({ t: 'rect', x: 6.25, y: 0, w: 1.5, h: H, c: inner }, { t: 'rect', x: 0, y: 6.75, w: W, h: 1.5, c: inner });
  return shapes;
}

/** Union flag (full 20×15 box). */
function union(): FlagShape[] {
  return [
    bg(C.navy),
    { t: 'line', d: `M0,0 L${W},${H} M${W},0 L0,${H}`, c: C.white, w: 3 },
    { t: 'line', d: `M0,0 L${W},${H} M${W},0 L0,${H}`, c: '#c8102e', w: 1 },
    { t: 'rect', x: 0, y: 5, w: W, h: 5, c: C.white },
    { t: 'rect', x: 7.5, y: 0, w: 5, h: H, c: C.white },
    { t: 'rect', x: 0, y: 6, w: W, h: 3, c: '#c8102e' },
    { t: 'rect', x: 8.5, y: 0, w: 3, h: H, c: '#c8102e' },
  ];
}

const UNION_CANTON: FlagShape = { t: 'nest', x: 0, y: 0, w: 10, h: 7.5, shapes: union() };

function usStripes(): FlagShape[] {
  const shapes: FlagShape[] = [bg(C.white)];
  const stripe = H / 13;
  for (let index = 0; index < 13; index += 2) shapes.push({ t: 'rect', x: 0, y: index * stripe, w: W, h: stripe, c: '#b22234' });
  shapes.push({ t: 'rect', x: 0, y: 0, w: 8, h: stripe * 7, c: '#3c3b6e' });
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) shapes.push({ t: 'circle', cx: 1.2 + col * 1.9, cy: 1.3 + row * 2.4, r: 0.38, c: C.white });
  }
  return shapes;
}

export const FLAG_SHAPES: Readonly<Record<string, readonly FlagShape[]>> = {
  US: usStripes(),
  CA: [
    ...v('#d80621', C.white, C.white, '#d80621'),
    { t: 'poly', p: '10,3.2 11,5.6 12.6,5 12,8 13.4,8.4 10.4,10.6 10.4,12 9.6,12 9.6,10.6 6.6,8.4 8,8 7.4,5 9,5.6', c: '#d80621' },
  ],
  GB: union(),
  IE: v('#169b62', C.white, C.orange),
  AU: [bg(C.navy), UNION_CANTON, star(5, 11.5, 1.6, C.white), star(15, 4, 0.9, C.white), star(17, 8, 0.9, C.white), star(14.5, 12, 0.9, C.white)],
  NZ: [bg(C.navy), UNION_CANTON, star(15, 4, 0.9, '#cc142b'), star(17, 7.5, 0.9, '#cc142b'), star(14, 8.5, 0.8, '#cc142b'), star(15, 12, 1, '#cc142b')],
  DE: h(C.black, '#dd0000', '#ffce00'),
  FR: v('#002395', C.white, '#ed2939'),
  ES: [...hw([['#aa151b', 1], ['#f1bf00', 2], ['#aa151b', 1]]), { t: 'rect', x: 4.5, y: 5.6, w: 2.4, h: 3.2, c: '#ad1519' }],
  PT: [bg('#da291c'), { t: 'rect', x: 0, y: 0, w: 8, h: H, c: '#046a38' }, { t: 'circle', cx: 8, cy: 7.5, r: 2.6, c: '#ffe900' }, { t: 'circle', cx: 8, cy: 7.5, r: 1.5, c: '#da291c' }],
  IT: v('#009246', C.white, '#ce2b37'),
  NL: h('#ae1c28', C.white, '#21468b'),
  BE: v(C.black, '#fdda24', '#ef3340'),
  CH: [bg('#da291c'), { t: 'rect', x: 8.6, y: 3, w: 2.8, h: 9, c: C.white }, { t: 'rect', x: 5.5, y: 6.1, w: 9, h: 2.8, c: C.white }],
  AT: h('#c8102e', C.white, '#c8102e'),
  SE: nordic('#006aa7', '#fecc00'),
  NO: nordic('#ba0c2f', C.white, '#00205b'),
  DK: nordic('#c8102e', C.white),
  FI: nordic(C.white, '#002f6c'),
  PL: h(C.white, '#dc143c'),
  CZ: [...h(C.white, '#d7141a'), { t: 'poly', p: '0,0 9,7.5 0,15', c: '#11457e' }],
  GR: (() => {
    const shapes: FlagShape[] = [bg('#0d5eaf')];
    const stripe = H / 9;
    for (let index = 1; index < 9; index += 2) shapes.push({ t: 'rect', x: 0, y: index * stripe, w: W, h: stripe, c: C.white });
    shapes.push({ t: 'rect', x: 0, y: 0, w: stripe * 5, h: stripe * 5, c: '#0d5eaf' });
    shapes.push({ t: 'rect', x: stripe * 2, y: 0, w: stripe, h: stripe * 5, c: C.white }, { t: 'rect', x: 0, y: stripe * 2, w: stripe * 5, h: stripe, c: C.white });
    return shapes;
  })(),
  TR: [bg('#e30a17'), { t: 'circle', cx: 7.5, cy: 7.5, r: 3.75, c: C.white }, { t: 'circle', cx: 8.4, cy: 7.5, r: 3, c: '#e30a17' }, star(12.4, 7.5, 1.6, C.white)],
  IL: [
    bg(C.white),
    { t: 'rect', x: 0, y: 1.5, w: W, h: 2, c: '#0038b8' },
    { t: 'rect', x: 0, y: 11.5, w: W, h: 2, c: '#0038b8' },
    { t: 'line', d: 'M10,4.6 L12.6,9 L7.4,9 Z M10,10.4 L7.4,6 L12.6,6 Z', c: '#0038b8', w: 0.6 },
  ],
  AE: [...h('#00732f', C.white, C.black), { t: 'rect', x: 0, y: 0, w: 5, h: H, c: '#ff0000' }],
  SA: [bg('#006c35'), { t: 'rect', x: 4, y: 5, w: 12, h: 1.6, c: C.white }, { t: 'rect', x: 5, y: 9.5, w: 10, h: 0.8, c: C.white }],
  EG: [...h('#ce1126', C.white, C.black), { t: 'circle', cx: 10, cy: 7.5, r: 1.3, c: '#c09300' }],
  ZA: [
    ...h('#e03c31', '#e03c31', '#001489', '#001489'),
    { t: 'poly', p: '0,0 3,0 10,6 20,6 20,9 10,9 3,15 0,15', c: C.white },
    { t: 'poly', p: '0,1.2 1.6,0 1.8,0 9.4,6.8 20,6.8 20,8.2 9.4,8.2 1.8,15 1.6,15 0,13.8', c: '#007749' },
    { t: 'poly', p: '0,3 6.2,7.5 0,12', c: '#ffb81c' },
    { t: 'poly', p: '0,4.2 4.6,7.5 0,10.8', c: C.black },
  ],
  NG: v('#008751', C.white, '#008751'),
  KE: [
    ...hw([[C.black, 4], [C.white, 1], ['#bb0000', 4], [C.white, 1], ['#006600', 4]]),
    { t: 'poly', p: '10,3 11.6,7.5 10,12 8.4,7.5', c: '#bb0000' },
  ],
  IN: [...h('#ff9933', C.white, '#138808'), { t: 'circle', cx: 10, cy: 7.5, r: 1.6, c: '#000080' }, { t: 'circle', cx: 10, cy: 7.5, r: 1.1, c: C.white }, { t: 'circle', cx: 10, cy: 7.5, r: 0.35, c: '#000080' }],
  PK: [bg('#01411c'), { t: 'rect', x: 0, y: 0, w: 5, h: H, c: C.white }, { t: 'circle', cx: 12.4, cy: 7.8, r: 3.6, c: C.white }, { t: 'circle', cx: 13.4, cy: 7, r: 3.1, c: '#01411c' }, star(14.6, 5.8, 1.1, C.white)],
  SG: [...h('#ef3340', C.white), { t: 'circle', cx: 4.4, cy: 3.75, r: 2.4, c: C.white }, { t: 'circle', cx: 5.4, cy: 3.75, r: 2.2, c: '#ef3340' }],
  MY: (() => {
    const shapes: FlagShape[] = [bg(C.white)];
    const stripe = H / 14;
    for (let index = 0; index < 14; index += 2) shapes.push({ t: 'rect', x: 0, y: index * stripe, w: W, h: stripe, c: '#cc0001' });
    shapes.push({ t: 'rect', x: 0, y: 0, w: 10, h: stripe * 8, c: '#010066' });
    shapes.push({ t: 'circle', cx: 4, cy: 4.3, r: 2.6, c: '#ffcc00' }, { t: 'circle', cx: 4.9, cy: 4.3, r: 2.2, c: '#010066' }, star(7.6, 4.3, 1.5, '#ffcc00'));
    return shapes;
  })(),
  ID: h('#ce1126', C.white),
  PH: [...h('#0038a8', '#ce1126'), { t: 'poly', p: '0,0 8.7,7.5 0,15', c: C.white }, { t: 'circle', cx: 3.2, cy: 7.5, r: 1.3, c: '#fcd116' }],
  TH: hw([['#a51931', 1], [C.white, 1], ['#2d2a4a', 2], [C.white, 1], ['#a51931', 1]]),
  VN: [bg('#da251d'), star(10, 7.7, 4.2, '#ffff00')],
  CN: [bg('#ee1c25'), star(4, 4, 2.4, '#ffff00'), star(8, 1.8, 0.7, '#ffff00'), star(9.4, 3.6, 0.7, '#ffff00'), star(9.4, 6, 0.7, '#ffff00'), star(8, 7.6, 0.7, '#ffff00')],
  HK: [bg('#de2910'), { t: 'circle', cx: 10, cy: 7.5, r: 3.4, c: C.white }, { t: 'circle', cx: 10, cy: 7.5, r: 1.1, c: '#de2910' }],
  TW: [bg('#fe0000'), { t: 'rect', x: 0, y: 0, w: 10, h: 7.5, c: '#000095' }, { t: 'circle', cx: 5, cy: 3.75, r: 2.1, c: C.white }],
  JP: [bg(C.white), { t: 'circle', cx: 10, cy: 7.5, r: 4.5, c: '#bc002d' }],
  KR: [
    bg(C.white),
    { t: 'circle', cx: 10, cy: 7.5, r: 3.6, c: '#0047a0' },
    { t: 'poly', p: '6.4,7.5 7,5.6 8.4,4.3 10,3.9 11.6,4.3 13,5.6 13.6,7.5', c: '#cd2e3a' },
    { t: 'line', d: 'M3,3 L5,1.6 M3.6,3.8 L5.6,2.4 M14.4,12.6 L16.4,11.2 M15,13.4 L17,12 M3,12 L5,13.4 M15,1.6 L17,3', c: C.black, w: 0.55 },
  ],
  MX: [...v('#006847', C.white, '#ce1126'), { t: 'circle', cx: 10, cy: 7.5, r: 1.6, c: '#8c6a2e' }],
  BR: [bg('#009c3b'), { t: 'poly', p: '10,1.6 18.2,7.5 10,13.4 1.8,7.5', c: '#ffdf00' }, { t: 'circle', cx: 10, cy: 7.5, r: 3.3, c: '#002776' }],
  AR: [...h('#74acdf', C.white, '#74acdf'), { t: 'circle', cx: 10, cy: 7.5, r: 1.4, c: '#f6b40e' }],
  CL: [...h(C.white, '#d52b1e'), { t: 'rect', x: 0, y: 0, w: 7.5, h: 7.5, c: '#0039a6' }, star(3.75, 3.75, 2, C.white)],
  CO: hw([['#fcd116', 2], ['#003893', 1], ['#ce1126', 1]]),
  PE: v('#d91023', C.white, '#d91023'),
  UA: h('#0057b7', '#ffd700'),
  RO: v('#002b7f', '#fcd116', '#ce1126'),
  HU: h('#cd2a3e', C.white, '#436f4d'),
};

/**
 * Social preview images (Open Graph and Twitter), one per route through Next's `opengraph-image`
 * and `twitter-image` file convention. Each one is drawn once at build time, so the site stays
 * fully static.
 *
 * The artwork is read from the supplied brand files and placed unchanged: the KitStak lockup, the
 * app icons and the Pulse lettered logo. Type is Bebas Neue, the brand display face
 * (src/assets/fonts, SIL Open Font License).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

const NAVY = '#0a1628';
const CREAM = '#f4f1e9';
const RED = '#c8102e';

type OgApp = 'crm' | 'wms' | 'projects';

/** The brand export names the WMS icon "warehouse" (see app-icon.tsx). */
const APP_ICON: Readonly<Record<OgApp, string>> = {
  crm: 'apps/kitstak-icon-crm.svg',
  wms: 'apps/kitstak-icon-warehouse.svg',
  projects: 'apps/kitstak-icon-projects.svg',
};

const KITSTAK_LOCKUP = { file: 'kitstak-lockup-cream.png', type: 'image/png', ratio: 1200 / 228 };
/** The official lettered logo for dark backgrounds (viewBox 1045 by 200). */
const PULSE_LOGO = {
  file: 'logos/kitstak-logo-pulse-on-dark.svg',
  type: 'image/svg+xml',
  ratio: 1045 / 200,
};

export interface OgCard {
  /** Which logo leads the card. `pulse` uses the Pulse lettered logo; the rest use the KitStak lockup. */
  readonly brand: 'kitstak' | 'pulse';
  /** App icon and name shown above the promise, for a product page without its own lettered logo. */
  readonly app?: { readonly id: OgApp; readonly name: string };
  /** The one line promise. */
  readonly promise: string;
  /** The page address, written without the scheme. */
  readonly address: string;
}

/** Reads a supplied brand file (a path under public/brand) as it is, for embedding in the card. */
async function dataUrl(file: string, type: string): Promise<string> {
  const bytes = await readFile(path.join(process.cwd(), 'public', 'brand', file));
  return `data:${type};base64,${bytes.toString('base64')}`;
}

export async function ogImage(card: OgCard): Promise<ImageResponse> {
  const logo = card.brand === 'pulse' ? PULSE_LOGO : KITSTAK_LOCKUP;
  const logoHeight = card.brand === 'pulse' ? 96 : 60;
  // A long promise runs to three lines, so it is set a step smaller to stay inside the card.
  const promiseSize = card.promise.length > 32 ? 100 : 124;
  const [font, logoSrc, iconSrc] = await Promise.all([
    readFile(path.join(process.cwd(), 'src', 'assets', 'fonts', 'BebasNeue-Regular.ttf')),
    dataUrl(logo.file, logo.type),
    card.app ? dataUrl(APP_ICON[card.app.id], 'image/svg+xml') : Promise.resolve(null),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        background: NAVY,
        color: CREAM,
        fontFamily: 'Bebas Neue',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <img src={logoSrc} alt="" width={Math.round(logoHeight * logo.ratio)} height={logoHeight} />
        {card.app && iconSrc ? (
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, letterSpacing: 4 }}>
            <img src={iconSrc} alt="" width={96} height={96} />
            <span style={{ marginLeft: 8 }}>{card.app.name}</span>
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: 132, height: 14, background: RED }} />
        <div
          style={{ marginTop: 28, fontSize: promiseSize, lineHeight: 0.96, letterSpacing: 1, maxWidth: 1040 }}
        >
          {card.promise}
        </div>
        <div style={{ marginTop: 28, fontSize: 32, letterSpacing: 4, opacity: 0.72 }}>{card.address}</div>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [{ name: 'Bebas Neue', data: font, weight: 400, style: 'normal' }],
    },
  );
}

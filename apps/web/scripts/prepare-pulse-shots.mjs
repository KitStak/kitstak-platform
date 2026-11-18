// Turns the raw Pulse screenshots into the web images under public/pulse/shots.
//
//   node scripts/prepare-pulse-shots.mjs <rawDir> [slot ...]
//
// With no slot names it rebuilds the whole folder. With names it redoes only those slots.
//
// <rawDir> holds the PNG files written by capture-pulse-shots.mjs, named <slot>-<view>-<theme>.png.
// This script only crops, scales and compresses. It never changes what a screenshot shows.
// The slots, views and widths here must match PULSE_SHOTS in src/components/pulse/pulse-shots.ts.
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [RAW, ...only] = process.argv.slice(2);
const OUT = 'public/pulse/shots';
if (!RAW) {
  console.error('usage: node scripts/prepare-pulse-shots.mjs <rawDir>');
  process.exit(1);
}

/** Output widths in pixels. The first width is also written as WebP for browsers without AVIF. */
const DESKTOP = [1200, 1800, 2400];
const TABLET = [1024, 1536, 2048];
const PHONE = [780];

/**
 * One entry per slot and view. `crop` is in pixels of the raw file (twice the CSS size) and only
 * trims empty page or the app shell around the part the page talks about.
 */
const SHOTS = [
  { name: 'home', view: 'desktop', widths: DESKTOP },
  { name: 'home', view: 'tablet', widths: TABLET },
  { name: 'home', view: 'phone', widths: PHONE },
  { name: 'profit', view: 'desktop', widths: DESKTOP },
  { name: 'profit', view: 'tablet', widths: TABLET },
  { name: 'profit', view: 'phone', widths: PHONE },
  { name: 'jobs', view: 'desktop', widths: DESKTOP },
  { name: 'jobs', view: 'tablet', widths: TABLET },
  { name: 'jobs', view: 'phone', widths: PHONE },
  { name: 'log', view: 'desktop', widths: DESKTOP },
  { name: 'log', view: 'tablet', widths: TABLET },
  { name: 'log', view: 'phone', widths: PHONE },
  { name: 'why', view: 'desktop', widths: DESKTOP },
  { name: 'why', view: 'tablet', widths: TABLET },
  { name: 'why', view: 'phone', widths: PHONE },
  // The dialog alone, 760 by 876 CSS pixels.
  { name: 'rates', view: 'desktop', widths: [760, 1520] },
  { name: 'rates', view: 'phone', widths: PHONE },
  // The Check step ends at 760 CSS pixels. The rest of the window is empty page.
  { name: 'import', view: 'desktop', widths: DESKTOP, crop: { left: 0, top: 0, width: 2880, height: 1520 } },
  { name: 'import', view: 'tablet', widths: TABLET },
  { name: 'import', view: 'phone', widths: PHONE },
  // The settings column is 832 CSS pixels wide in the middle of the window, under the top bar.
  {
    name: 'connected-apps',
    view: 'desktop',
    widths: [872, 1744],
    crop: { left: 568, top: 112, width: 1744, height: 1688 },
  },
  { name: 'connected-apps', view: 'phone', widths: PHONE },
];

if (only.length === 0) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const shot of SHOTS) {
  if (only.length > 0 && !only.includes(shot.name)) continue;
  for (const theme of ['light', 'dark']) {
    const source = path.join(RAW, `${shot.name}-${shot.view}-${theme}.png`);
    const base = shot.crop ? sharp(source).extract(shot.crop) : sharp(source);
    const buffer = await base.png().toBuffer();
    const { width: rawWidth, height: rawHeight } = await sharp(buffer).metadata();
    for (const width of shot.widths) {
      if (width > rawWidth) throw new Error(`${source} is ${rawWidth} wide, too small for ${width}`);
      const stem = path.join(OUT, `${shot.name}-${shot.view}-${theme}-${width}`);
      const resized = sharp(buffer).resize({ width, kernel: 'lanczos3' });
      // 4:4:4 keeps small red and green text sharp.
      await resized
        .clone()
        .avif({ quality: 52, effort: 6, chromaSubsampling: '4:4:4' })
        .toFile(`${stem}.avif`);
      if (width === shot.widths[0])
        await resized.clone().webp({ quality: 80, effort: 6 }).toFile(`${stem}.webp`);
    }
    console.log(`${shot.name}-${shot.view}-${theme}: ${rawWidth / 2} by ${rawHeight / 2} CSS pixels`);
  }
}

let total = 0;
let largest = { file: '', size: 0 };
const files = readdirSync(OUT);
for (const file of files) {
  const { size } = statSync(path.join(OUT, file));
  total += size;
  if (size > largest.size) largest = { file, size };
}
console.log(`${files.length} files, ${Math.round(total / 1024)} KB in all.`);
console.log(`Largest: ${largest.file}, ${Math.round(largest.size / 1024)} KB.`);

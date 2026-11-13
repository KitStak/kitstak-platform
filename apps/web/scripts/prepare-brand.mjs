// Trims transparent padding from the supplied brand PNGs. The artwork itself is untouched.
import sharp from 'sharp';
import path from 'node:path';

const SRC = process.argv[2];
const OUT = 'public/brand';
const jobs = [
  ['kitstak-logo-navy-transparent-3000.png', 'kitstak-lockup-navy.png', 1200],
  ['kitstak-logo-transparent-3000.png', 'kitstak-lockup-cream.png', 1200],
  ['Kitstak Bars Transparent.png', 'kitstak-mark.png', 256],
  ['kitstak-icon-1024.png', 'kitstak-icon-512.png', 512],
];
for (const [src, out, width] of jobs) {
  const img = sharp(path.join(SRC, src));
  const trimmed = src.startsWith('kitstak-icon') ? img : img.trim({ threshold: 1 });
  const info = await trimmed.resize({ width, withoutEnlargement: true }).png().toFile(path.join(OUT, out));
  console.log(out, info.width, info.height);
}

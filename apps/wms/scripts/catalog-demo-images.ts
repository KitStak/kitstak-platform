/**
 * `npx tsx scripts/catalog-demo-images.ts [--apply]` (owner M09).
 *
 * Gives every seed-catalog product without an image the built-in demo illustration
 * (`/api/products/demo-image/<kind>-<hex>.svg`), so the grid image column, listings and detail
 * header are not all placeholders in a demo. Products that already have an image and test SKUs
 * (KS-CRIT-/KS-E2E-) are left alone. Each update bumps the product version and writes the
 * change log. Without --apply it prints the plan and changes nothing.
 */
import { closeDb, getDb } from '../src/server/db';
import { withWriteTx } from '../src/server/db/sql';
import { applyDemoImages, planDemoImages } from '../src/server/repositories/products-demo-images';

const apply = process.argv.includes('--apply');

async function main(): Promise<number> {
  try {
    const db = await getDb();
    const rows = apply
      ? await withWriteTx(
          db,
          async (tx) => await applyDemoImages(tx, { userId: null, source: 'Demo catalog images' }),
        )
      : await planDemoImages(db);
    for (const r of rows) process.stdout.write(`  ${r.sku.padEnd(22)} ${r.imageUrl}\n`);
    process.stdout.write(
      `${apply ? 'Applied' : 'Dry run'}: ${rows.length} product(s).${apply ? '' : ' Re-run with --apply to change data.'}\n`,
    );
    return 0;
  } finally {
    await closeDb();
  }
}

void main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);

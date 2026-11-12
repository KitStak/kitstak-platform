/** Count Location / SKU Details lists (M07). */
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import type { GridQuery } from "@/server/query/grid-query";
import { gridRowsById, raw, runGrid, type GridPage } from "./counts-grid";
import { lineGrid, lineRow, type CountLineListRow, type LineGridKind } from "./counts-grids";

export async function listCountLines(db: AppDb, scope: Scope, kind: LineGridKind, query: GridQuery): Promise<GridPage<CountLineListRow>> {
  const page = await runGrid<CountLineListRow>(db, lineGrid(scope, kind), query);
  return { ...page, rows: page.rows.map(lineRow) };
}

export async function countLinesById(db: AppDb, scope: Scope, ids: readonly string[]): Promise<CountLineListRow[]> {
  return (await gridRowsById<CountLineListRow>(db, lineGrid(scope, "plan"), raw("l.id"), ids)).map(lineRow);
}

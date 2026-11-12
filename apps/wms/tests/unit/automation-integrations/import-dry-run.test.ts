/** Dry-run parity: the preview applies valid rows in a rolled-back transaction, so referential errors match a real run. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clients, importBatches, tags } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { previewImport } from "@/server/imports/pipeline";
import type { ImportDefinition } from "@/server/imports/types";
import { AppError } from "@/server/api/errors";
import { authFor, seededDb, type SeededDb } from "../foundation-f6/fixtures";

/** Like a real handler: looks up the client by code and refuses unknown ones. */
const def: ImportDefinition = {
  key: "test-tags-by-client",
  title: "Import Tags",
  description: "",
  backHref: "/",
  backLabel: "Go back",
  permission: "settings.users.import_file",
  templateColumns: [
    { key: "name", header: "Tag Name", type: "text", required: true, example: "VIP" },
    { key: "clientCode", header: "Client Code", type: "text", required: true, example: "ACME" },
  ],
  handler: {
    configured: true,
    owner: "test",
    apply: async (ctx, row) => {
      const client = (await ctx.db.select().from(clients).where(eq(clients.code, String(row.clientCode))).limit(1))[0];
      if (!client) throw new AppError("VALIDATION", `Client ${String(row.clientCode)} not found`);
      return { entityId: (await ctx.db.insert(tags).values({ name: String(row.name), color: "Red" }).returning())[0].id };
    },
  },
};

describe("import dry run", () => {
  let testDb: SeededDb;
  beforeEach(async () => { testDb = await seededDb(); });
  afterEach(async () => { await testDb.close(); });

  it("reports the same referential errors as the real run and writes nothing", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    const code = (await testDb.db.select().from(clients).limit(1))[0]?.code ?? "";
    const bytes = Buffer.from(`Tag Name,Client Code\nGood,${code}\nBad,ACME-DOES-NOT-EXIST`);
    const preview = await previewImport({ def, auth, fileName: "t.csv", bytes }, testDb.db);
    expect(preview).toMatchObject({ totalRows: 2, validCount: 1, errorCount: 1 });
    expect(preview.rows[0]).toMatchObject({ valid: false, errors: ["Client ACME-DOES-NOT-EXIST not found"] });
    expect(await testDb.db.select().from(tags)).toHaveLength(0);
    expect(await testDb.db.select().from(importBatches)).toHaveLength(0);
  });

  it("without a db it stays a column-only preview", async () => {
    const auth = await authFor(testDb, testDb.ids.admin);
    const preview = await previewImport({ def, auth, fileName: "t.csv", bytes: Buffer.from("Tag Name,Client Code\nBad,NOPE") });
    expect(preview).toMatchObject({ validCount: 1, errorCount: 0 });
  });
});

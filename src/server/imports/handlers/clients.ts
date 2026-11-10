/**
 * Import handler "clients" (owner M11). Upserts by Client Code: new codes create a client
 * (USD, every switch off) through `createClient`; existing codes update name, contact and
 * status through `updateClient`. A Billing address in the row becomes the default Billing
 * address. Every write logs field-level change_log on the client.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { CLIENT_DEFAULTS, clientSchema, type ClientInput } from "@/lib/grid-defs/organization/clients";
import { createClient, getClient, updateClient } from "@/server/repositories/clients";
import { detailAddressesToInput } from "@/server/repositories/clients-import";
import type { ImportHandler, ImportRowValues } from "../types";

const str = (v: ImportRowValues[string]): string | null => (v === null || v === undefined || v === "" ? null : String(v).trim());
function fail(message: string): never {
  throw new DomainError("VALIDATION", message);
}

function billingAddress(row: ImportRowValues): NonNullable<ClientInput["addresses"]> {
  const line1 = str(row.billingAddress1);
  if (!line1) return [];
  return [{
    name: "Billing", usageType: "Billing", line1, line2: str(row.billingAddress2), city: str(row.billingCity) ?? fail("Billing City is required with a billing address"),
    state: str(row.billingState), postalCode: str(row.billingPostalCode) ?? fail("Billing Postal Code is required with a billing address"),
    country: (str(row.billingCountry) ?? "US").toUpperCase(), isDefault: true, isActive: true,
  }];
}

function parse(input: ClientInput) {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) fail(parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; "));
  return parsed.data;
}

export const handler: ImportHandler = {
  configured: true,
  owner: "M11",
  apply(ctx, row) {
    const { db, auth, actor } = ctx;
    const code = (str(row.code) ?? fail("Client Code is required")).toUpperCase();
    const name = str(row.name) ?? fail("Client Name is required");
    const status = str(row.status) === "Inactive" ? "Inactive" : "Active";
    const existing = db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.code, code)).get();
    if (!existing) {
      const created = createClient(db, auth, actor, parse({
        ...CLIENT_DEFAULTS, code, name, officialName: name, status, contactName: str(row.contactName) ?? "", contactEmail: str(row.email) ?? "", phone: str(row.phone) ?? "",
        addresses: billingAddress(row),
      }));
      return { entityId: created.id, message: `Client ${code} created` };
    }
    const d = getClient(db, auth, existing.id);
    const billing = billingAddress(row);
    const kept = detailAddressesToInput(d.addresses).filter((a) => !(billing.length && a.usageType === "Billing" && a.isDefault));
    const saved = updateClient(db, auth, actor, d.id, parse({
      name, code: d.code, officialName: d.officialName ?? name, status, contactName: str(row.contactName) ?? d.contactName, contactEmail: str(row.email) ?? d.contactEmail,
      phone: str(row.phone) ?? d.phone, currency: d.currency as ClientInput["currency"], settings: d.settings, taxId: d.taxId ?? "", billingPlan: d.billingPlan as ClientInput["billingPlan"],
      customFields: d.customFields as ClientInput["customFields"], sscc: d.sscc, note: "", addresses: [...kept, ...billing], version: d.version,
    }));
    return { entityId: saved.id, message: `Client ${code} updated` };
  },
};

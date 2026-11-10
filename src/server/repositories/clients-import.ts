/** Maps stored owned addresses back to the address schema input (imports, edits). */
import type { OrgAddressInput } from "@/lib/grid-defs/organization/common";
import type { OwnedAddress } from "./clients-shared";

export function detailAddressesToInput(list: readonly OwnedAddress[]): OrgAddressInput[] {
  return list.map((a) => ({
    id: a.id, name: a.name || a.usageType, usageType: a.usageType, companyName: a.companyName ?? "", line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state ?? "",
    postalCode: a.postalCode, country: a.country, phone: a.phone ?? "", email: a.email ?? "", isDefault: a.isDefault, isActive: a.isActive,
  }));
}

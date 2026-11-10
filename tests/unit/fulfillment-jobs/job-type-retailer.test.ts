/** M03 round 5: retailer compliance settings of Picking job types (Logiwa 02 §6 step 3). */
import { describe, expect, it } from "vitest";
import { jobTypeInputSchema, retailerOf } from "@/lib/grid-defs/jobs/forms";

const base = (settings: Record<string, unknown>) => ({
  code: "RC-PICK", description: "Retailer picks", warehouseId: "wh", operationType: "Picking", allocationAlgorithmId: "algo", settings,
});

describe("retailer settings", () => {
  it("defaults to None and survives parsing (not stripped)", () => {
    const parsed = jobTypeInputSchema.parse(base({}));
    expect(parsed.settings.retailer).toEqual({ flowType: "None", uccLabelScanningType: "None", defaultLabelPrintOption: "None" });
    const rc = jobTypeInputSchema.parse(base({
      template: "Retailer Compliance", retailer: { flowType: "Retailer Post-Picking UCC Generation", uccLabelScanningType: "Scan Parent LP", defaultLabelPrintOption: "Print All UCC Labels" },
    }));
    expect(retailerOf(rc.settings)).toEqual({ flowType: "Retailer Post-Picking UCC Generation", uccLabelScanningType: "Scan Parent LP", defaultLabelPrintOption: "Print All UCC Labels" });
  });

  it("rejects a retailer flow outside the Retailer Compliance template", () => {
    const res = jobTypeInputSchema.safeParse(base({ template: "Custom", retailer: { flowType: "Retailer Pre-Picking UCC Generation" } }));
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["settings", "retailer", "flowType"]);
  });

  it("rejects UCC scanning / print options without post-picking UCC generation", () => {
    const res = jobTypeInputSchema.safeParse(base({ template: "Retailer Compliance", retailer: { flowType: "Retailer Pre-Picking UCC Generation", uccLabelScanningType: "Scan Each Carton" } }));
    expect(res.success).toBe(false);
    expect(res.error?.issues.some((i) => i.path.join(".") === "settings.retailer.uccLabelScanningType")).toBe(true);
  });

  it("reads legacy rows without the key as None", () => {
    expect(retailerOf({ template: "Custom" }).flowType).toBe("None");
    expect(retailerOf(null).flowType).toBe("None");
    expect(retailerOf({ retailer: { flowType: "bogus" } }).flowType).toBe("None");
  });
});

/** Set Carrier Service / Set Rate Shopping Preset / Set Shipment Package (M12). */
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import type { WorkflowActionExecutor } from "./types";
import { loadOrder, patchOrder, str } from "./order-patch";

export const setCarrierService: WorkflowActionExecutor = async (tx, ctx, input) => {
  const order = await loadOrder(tx, input);
  const id = str(input.params.carrierServiceId);
  if (!id) throw new DomainError("VALIDATION", "Choose a carrier service");
  const svc = (await tx.select({ s: schema.carrierServices, c: schema.carrierConnections }).from(schema.carrierServices)
    .innerJoin(schema.carrierConnections, eq(schema.carrierConnections.id, schema.carrierServices.connectionId))
    .where(eq(schema.carrierServices.id, id)).limit(1))[0];
  if (!svc || !svc.s.isActive || !svc.c.isActive) throw new DomainError("VALIDATION", "The carrier service is inactive or no longer exists");
  if (svc.c.warehouseId !== order.warehouseId) throw new DomainError("RULE_VIOLATION", `${svc.c.setupName} is not set up for this order's warehouse`);
  const prevName = order.carrierServiceId ? (await tx.select({ n: schema.carrierServices.name }).from(schema.carrierServices).where(eq(schema.carrierServices.id, order.carrierServiceId)).limit(1))[0]?.n ?? null : null;
  const applied = await patchOrder(tx, ctx, order, {
    carrierConnectionId: svc.c.id, carrierServiceId: svc.s.id, carrier: svc.s.carrierCode.toUpperCase(), shippingService: svc.s.name, rateShoppingPresetId: null,
  }, input.workflowName, { carrierServiceId: { from: prevName, to: svc.s.name }, carrierConnectionId: { from: null, to: svc.c.setupName } });
  return { applied, message: applied ? undefined : "Carrier service already set" };
};

export const setRateShoppingPreset: WorkflowActionExecutor = async (tx, ctx, input) => {
  const order = await loadOrder(tx, input);
  const id = str(input.params.presetId);
  if (!id) throw new DomainError("VALIDATION", "Choose a rate shopping preset");
  const p = schema.rateShoppingPresets;
  const preset = (await tx.select().from(p).where(and(eq(p.id, id), eq(p.isActive, true))).limit(1))[0];
  if (!preset) throw new DomainError("VALIDATION", "The rate shopping preset is inactive or no longer exists");
  if (preset.clientId !== order.clientId || preset.warehouseId !== order.warehouseId) throw new DomainError("RULE_VIOLATION", `Preset ${preset.name} belongs to another client or warehouse`);
  const applied = await patchOrder(tx, ctx, order, { rateShoppingPresetId: preset.id, carrierServiceId: null }, input.workflowName, { rateShoppingPresetId: { from: null, to: preset.name } });
  return { applied, message: applied ? undefined : "Preset already set" };
};

export const setShipmentPackage: WorkflowActionExecutor = async (tx, ctx, input) => {
  const order = await loadOrder(tx, input);
  const id = str(input.params.shipmentPackageId);
  if (!id) throw new DomainError("VALIDATION", "Choose a shipment package");
  const pkg = (await tx.select().from(schema.shipmentPackages).where(eq(schema.shipmentPackages.id, id)).limit(1))[0];
  if (!pkg || !pkg.isActive) throw new DomainError("VALIDATION", "The shipment package is inactive or no longer exists");
  if (pkg.warehouseId !== order.warehouseId) throw new DomainError("RULE_VIOLATION", `Package ${pkg.code} belongs to another warehouse`);
  const applied = await patchOrder(tx, ctx, order, { shipmentPackageId: pkg.id }, input.workflowName, { shipmentPackageId: { from: null, to: pkg.code } });
  return { applied, message: applied ? undefined : "Package already set" };
};

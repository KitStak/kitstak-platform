/**
 * Carrier adapter contract (BUILD_PLAN F5 "Carriers"). The KitStak Sandbox adapter is
 * registered by default; real adapters (UPS, FedEx, EasyPost, Shippo) are registered by
 * M12 through `registerCarrierAdapter()`.
 */
import type { LABEL_FORMATS, LABEL_TYPES } from "@/lib/enums";
import type * as schema from "@/server/db/schema";
import type { AddressCheck, AddressInput } from "../address-verification";

export type CarrierConnectionRow = typeof schema.carrierConnections.$inferSelect;
export type CarrierServiceRow = typeof schema.carrierServices.$inferSelect;
export type LabelFormat = (typeof LABEL_FORMATS)[number];
export type LabelType = (typeof LABEL_TYPES)[number];

export interface CarrierAddress {
  readonly name: string;
  readonly company?: string | null;
  readonly line1: string;
  readonly line2?: string | null;
  readonly city: string;
  readonly state?: string | null;
  readonly postalCode: string;
  readonly country: string;
  readonly phone?: string | null;
}

export interface PackageSpec {
  readonly weightOz: number;
  readonly length: number;
  readonly width: number;
  readonly height: number;
}

export interface RateRequest {
  readonly connection: CarrierConnectionRow;
  readonly services: readonly CarrierServiceRow[];
  readonly from: CarrierAddress;
  readonly to: CarrierAddress;
  readonly packages: readonly PackageSpec[];
}

export interface RateQuote {
  readonly carrierServiceId: string;
  readonly serviceCode: string;
  readonly serviceName: string;
  readonly carrierCode: string;
  readonly amount: number;
  readonly currency: string;
  readonly transitDays: number;
  readonly zone: string;
  readonly estimatedDeliveryAt: string;
}

export interface LabelRequest {
  readonly connection: CarrierConnectionRow;
  readonly service: CarrierServiceRow;
  readonly from: CarrierAddress;
  readonly to: CarrierAddress;
  readonly packages: readonly PackageSpec[];
  readonly orderCode: string;
  /** Distinguishes repeated labels for the same order (e.g. after a void). */
  readonly attempt: number;
  readonly labelType: LabelType;
  readonly format: LabelFormat;
  readonly shipDate: string;
}

export interface LabelPackage {
  readonly trackingNumber: string;
  readonly amount: number;
  /** PDF bytes or ZPL text (UTF-8) for this package. */
  readonly label: Uint8Array;
}

export interface LabelResult {
  readonly masterTrackingNumber: string;
  readonly packages: readonly LabelPackage[];
  readonly totalAmount: number;
  readonly currency: string;
  readonly zone: string;
  readonly estimatedDeliveryAt: string;
  readonly format: LabelFormat;
}

export interface VoidRequest {
  readonly connection: CarrierConnectionRow;
  readonly trackingNumber: string;
}

export interface CarrierAdapter {
  readonly provider: string;
  rate(request: RateRequest): Promise<readonly RateQuote[]>;
  createLabel(request: LabelRequest): Promise<LabelResult>;
  voidLabel(request: VoidRequest): Promise<{ readonly voided: boolean; readonly message?: string }>;
  validateAddress(address: AddressInput): Promise<AddressCheck>;
}

/** Failure reported by a carrier; logged to `carrier_call_logs` with its HTTP code. */
export class CarrierError extends Error {
  readonly httpCode: number;

  constructor(message: string, httpCode = 400) {
    super(message);
    this.name = "CarrierError";
    this.httpCode = httpCode;
  }
}

declare global {
  var __kitstakCarrierAdapters: Map<string, CarrierAdapter> | undefined;
}

/**
 * Process-wide registry on `globalThis`: Next can load the shipping routes and the module that
 * registers M12's adapters in different bundles, and a lazily created map is also safe to call
 * while the carriers barrel is still evaluating (circular side-effect import below).
 */
function registry(): Map<string, CarrierAdapter> {
  globalThis.__kitstakCarrierAdapters ??= new Map<string, CarrierAdapter>();
  return globalThis.__kitstakCarrierAdapters;
}

export function registerCarrierAdapter(adapter: CarrierAdapter): void {
  registry().set(adapter.provider, adapter);
}

export function getCarrierAdapter(provider: string): CarrierAdapter | undefined {
  return registry().get(provider);
}

export function registeredCarrierProviders(): string[] {
  return [...registry().keys()];
}

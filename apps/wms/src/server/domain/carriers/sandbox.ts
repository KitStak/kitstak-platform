/**
 * KitStak Sandbox carrier: deterministic and complete.
 * - Rates come from a zone x weight x service table.
 * - Tracking numbers have valid formats and check digits: `1Z…` (UPS-like) and
 *   `9400…` (USPS-like IMpb, 22 digits).
 * - Labels are real 4x6 PDF or ZPL files with Code 128 barcodes.
 */
import { createHash } from 'node:crypto';
import { verifyAddress } from '../address-verification';
import {
  CarrierError,
  registerCarrierAdapter,
  type CarrierAdapter,
  type LabelRequest,
  type PackageSpec,
  type RateQuote,
  type RateRequest,
} from './adapter';
import { renderPdfLabel, renderZplLabel } from './label';
import { mapSeq } from '../../db/sql';

export const SANDBOX_PROVIDER = 'kitstaks-sandbox';

export interface SandboxService {
  readonly code: string;
  readonly name: string;
  readonly carrierCode: 'UPS' | 'USPS';
  readonly transitDays: number;
  readonly base: number;
  readonly perLb: number;
  /** UPS service indicator digits in the 1Z number. */
  readonly upsService?: string;
  readonly international?: boolean;
}

export const SANDBOX_SERVICES: readonly SandboxService[] = [
  {
    code: 'SBX_GROUND',
    name: 'Ground',
    carrierCode: 'UPS',
    transitDays: 5,
    base: 8.45,
    perLb: 0.62,
    upsService: '03',
  },
  {
    code: 'SBX_2DAY',
    name: '2nd Day Air',
    carrierCode: 'UPS',
    transitDays: 2,
    base: 16.2,
    perLb: 1.35,
    upsService: '02',
  },
  {
    code: 'SBX_NEXT_DAY',
    name: 'Next Day Air',
    carrierCode: 'UPS',
    transitDays: 1,
    base: 29.9,
    perLb: 2.4,
    upsService: '01',
  },
  {
    code: 'SBX_PRIORITY',
    name: 'Priority Mail',
    carrierCode: 'USPS',
    transitDays: 3,
    base: 7.95,
    perLb: 0.55,
  },
  {
    code: 'SBX_GROUND_ADVANTAGE',
    name: 'Ground Advantage',
    carrierCode: 'USPS',
    transitDays: 5,
    base: 4.85,
    perLb: 0.42,
  },
  {
    code: 'SBX_INTL',
    name: 'Worldwide Expedited',
    carrierCode: 'UPS',
    transitDays: 6,
    base: 42.5,
    perLb: 4.1,
    upsService: '08',
    international: true,
  },
];

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function sandboxZone(fromZip: string, toZip: string, international: boolean): number {
  if (international) return 9;
  const a = Number.parseInt(fromZip.slice(0, 3), 10);
  const b = Number.parseInt(toZip.slice(0, 3), 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return 8;
  return Math.min(8, 2 + Math.floor(Math.abs(a - b) / 150));
}

export function sandboxRate(service: SandboxService, zone: number, pkg: PackageSpec): number {
  const dimWeightLb = (pkg.length * pkg.width * pkg.height) / 139;
  const billableLb = Math.max(1, Math.ceil(Math.max(pkg.weightOz / 16, dimWeightLb)));
  return round2((service.base + service.perLb * billableLb) * (1 + (zone - 2) * 0.085));
}

const hashDigits = (seed: string, count: number): string => {
  const hex = createHash('sha1').update(seed).digest('hex');
  let out = '';
  for (let i = 0; out.length < count; i += 1) out += String(Number.parseInt(hex[i % hex.length], 16) % 10);
  return out;
};

/** UPS 1Z check digit over the 15 characters after "1Z". */
export function upsCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const v = /\d/.test(ch) ? Number(ch) : (ch.charCodeAt(0) - 63) % 10;
    sum += i % 2 === 1 ? v * 2 : v;
  }
  return (10 - (sum % 10)) % 10;
}

/** USPS IMpb mod-10 check digit (weights 3,1 from the right). */
export function uspsCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10;
}

export function sandboxTrackingNumber(service: SandboxService, seed: string): string {
  if (service.carrierCode === 'USPS') {
    const body = `9400111${hashDigits(seed, 14)}`;
    return `${body}${uspsCheckDigit(body)}`;
  }
  const body = `KS${hashDigits(`${seed}:shipper`, 4)}${service.upsService ?? '03'}${hashDigits(seed, 7)}`;
  return `1Z${body}${upsCheckDigit(body)}`;
}

function serviceFor(code: string): SandboxService {
  const s = SANDBOX_SERVICES.find((x) => x.code === code);
  if (!s) throw new CarrierError(`Service ${code} is not offered by the KitStak Sandbox.`, 400);
  return s;
}

const isInternational = (country: string): boolean =>
  !['united states', 'us', 'usa'].includes(country.trim().toLowerCase());

function deliveryDate(shipDate: string, transitDays: number): string {
  const d = new Date(`${shipDate.slice(0, 10)}T17:00:00.000Z`);
  let added = 0;
  while (added < transitDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.toISOString();
}

function quoteFor(
  req: Pick<RateRequest, 'from' | 'to' | 'packages'>,
  service: SandboxService,
  carrierServiceId: string,
  shipDate: string,
): RateQuote {
  const intl = isInternational(req.to.country);
  if (intl !== Boolean(service.international))
    throw new CarrierError(
      `${service.name} is ${service.international ? 'international only' : 'domestic only'}.`,
      400,
    );
  const zone = sandboxZone(req.from.postalCode, req.to.postalCode, intl);
  const amount = round2(req.packages.reduce((s, p) => s + sandboxRate(service, zone, p), 0));
  return {
    carrierServiceId,
    serviceCode: service.code,
    serviceName: service.name,
    carrierCode: service.carrierCode,
    amount,
    currency: 'USD',
    transitDays: service.transitDays,
    zone: String(zone),
    estimatedDeliveryAt: deliveryDate(shipDate, service.transitDays),
  };
}

function assertPackages(packages: readonly PackageSpec[]): void {
  if (packages.length === 0) throw new CarrierError('At least one package is required.', 400);
  for (const p of packages) {
    if (!(p.weightOz > 0)) throw new CarrierError('Package weight must be greater than 0.', 400);
    if (!(p.length > 0 && p.width > 0 && p.height > 0))
      throw new CarrierError('Package dimensions must be greater than 0.', 400);
    if (p.weightOz > 150 * 16) throw new CarrierError('Package exceeds the 150 lb limit.', 400);
  }
}

export const sandboxCarrier: CarrierAdapter = {
  provider: SANDBOX_PROVIDER,
  async rate(req) {
    assertPackages(req.packages);
    const today = new Date().toISOString().slice(0, 10);
    const quotes: RateQuote[] = [];
    for (const svc of req.services) {
      const service = SANDBOX_SERVICES.find((x) => x.code === svc.serviceCode);
      if (!service || Boolean(service.international) !== isInternational(req.to.country)) continue;
      quotes.push(quoteFor(req, service, svc.id, today));
    }
    return quotes;
  },
  async createLabel(req: LabelRequest) {
    assertPackages(req.packages);
    const check = verifyAddress(req.to);
    if (check.status === 'Failed')
      throw new CarrierError(`Address validation failed: ${check.notes.join(' ')}`, 422);
    const service = serviceFor(req.service.serviceCode);
    const quote = quoteFor(req, service, req.service.id, req.shipDate);
    const zone = Number(quote.zone);
    const packages = await Promise.all(
      await mapSeq(req.packages, async (pkg, i) => {
        const trackingNumber = sandboxTrackingNumber(
          service,
          `${req.orderCode}|${req.labelType}|${req.attempt}|${i + 1}`,
        );
        const data = {
          from: req.from,
          to: req.to,
          carrierCode: service.carrierCode,
          serviceName: service.name,
          trackingNumber,
          orderCode: req.orderCode,
          weightOz: pkg.weightOz,
          packageSeq: i + 1,
          packageCount: req.packages.length,
          shipDate: req.shipDate.slice(0, 10),
          labelType: req.labelType,
        };
        const label =
          req.format === 'PDF' ? await renderPdfLabel(data) : new TextEncoder().encode(renderZplLabel(data));
        return { trackingNumber, amount: sandboxRate(service, zone, pkg), label };
      }),
    );
    return {
      masterTrackingNumber: packages[0].trackingNumber,
      packages,
      totalAmount: round2(packages.reduce((s, p) => s + p.amount, 0)),
      currency: 'USD',
      zone: quote.zone,
      estimatedDeliveryAt: quote.estimatedDeliveryAt,
      format: req.format === 'PDF' ? 'PDF' : 'ZPL',
    };
  },
  async voidLabel(req) {
    if (!/^(1Z[0-9A-Z]{16}|9400\d{18})$/.test(req.trackingNumber))
      throw new CarrierError(`Unknown tracking number ${req.trackingNumber}.`, 404);
    return { voided: true };
  },
  async validateAddress(address) {
    return verifyAddress(address);
  },
};

registerCarrierAdapter(sandboxCarrier);

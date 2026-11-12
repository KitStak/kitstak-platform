/** UPS adapter (M12): OAuth client credentials + Rating / Shipping / Void APIs; Test env = validated simulation. */
import {
  CarrierError,
  type CarrierAddress,
  type LabelRequest,
  type RateRequest,
} from '@/server/domain/carriers/adapter';
import {
  assertPackages,
  buildCarrierAdapter,
  carrierFetch,
  need,
  phoneDigits,
  type CarrierDef,
} from './common';
import type { Credentials } from '../crypto';

const host = (env: string) =>
  env === 'Production' ? 'https://onlinetools.ups.com' : 'https://wwwcie.ups.com';

async function token(env: string, creds: Credentials): Promise<string> {
  const basic = Buffer.from(
    `${need(creds, 'apiKey', 'API key')}:${need(creds, 'apiSecret', 'API secret')}`,
  ).toString('base64');
  const body = await carrierFetch(`${host(env)}/security/v1/oauth/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const t = body.access_token;
  if (typeof t !== 'string') throw new CarrierError('UPS did not return an access token', 401);
  return t;
}

const addr = (a: CarrierAddress) => ({
  Name: a.name,
  AttentionName: a.name,
  Phone: { Number: phoneDigits(a.phone) },
  Address: {
    AddressLine: [a.line1, a.line2].filter(Boolean),
    City: a.city,
    StateProvinceCode: a.state ?? '',
    PostalCode: a.postalCode,
    CountryCode: a.country.length === 2 ? a.country : 'US',
  },
});
const pkgs = (r: Pick<RateRequest, 'packages'>) =>
  r.packages.map((p) => ({
    PackagingType: { Code: '02' },
    Dimensions: {
      UnitOfMeasurement: { Code: 'IN' },
      Length: String(p.length),
      Width: String(p.width),
      Height: String(p.height),
    },
    PackageWeight: {
      UnitOfMeasurement: { Code: 'LBS' },
      Weight: String(Math.max(0.1, Math.round((p.weightOz / 16) * 10) / 10)),
    },
  }));

function validate(from: CarrierAddress, to: CarrierAddress): void {
  if (phoneDigits(from.phone).length < 10)
    throw new CarrierError('ShipFrom PhoneNumber must be at least 10 alphanumeric characters', 400);
  if (!from.line1 || !from.postalCode) throw new CarrierError('Missing or invalid shipper address', 400);
  if (!to.postalCode) throw new CarrierError('Missing or invalid ship to postal code', 400);
  if (to.name.length > 35) throw new CarrierError('ShipTo Name must be 35 characters or less', 400);
}

export const UPS_DEF: CarrierDef = {
  provider: 'ups',
  carrierCode: 'UPS',
  trackingPrefix: '1Z',
  trackingLength: 16,
  credentialFields: [
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'apiSecret', label: 'API secret', secret: true },
  ],
  services: [
    { code: '03', name: 'UPS Ground', transitDays: 5, base: 8.95, perLb: 0.64 },
    { code: '93', name: 'UPS Ground Saver', transitDays: 6, base: 7.6, perLb: 0.55 },
    { code: '12', name: 'UPS 3 Day Select', transitDays: 3, base: 13.4, perLb: 1.05 },
    { code: '02', name: 'UPS 2nd Day Air', transitDays: 2, base: 16.8, perLb: 1.38 },
    { code: '59', name: 'UPS 2nd Day Air A.M.', transitDays: 2, base: 19.2, perLb: 1.5 },
    { code: '13', name: 'UPS Next Day Air Saver', transitDays: 1, base: 27.1, perLb: 2.1 },
    { code: '01', name: 'UPS Next Day Air', transitDays: 1, base: 30.4, perLb: 2.42 },
    { code: '14', name: 'UPS Next Day Air Early', transitDays: 1, base: 58, perLb: 2.9 },
    { code: '11', name: 'UPS Standard', transitDays: 4, base: 21, perLb: 2.2, international: true },
    {
      code: '08',
      name: 'UPS Worldwide Expedited',
      transitDays: 5,
      base: 44,
      perLb: 4.2,
      international: true,
    },
    { code: '65', name: 'UPS Worldwide Saver', transitDays: 3, base: 52, perLb: 4.9, international: true },
    { code: '07', name: 'UPS Worldwide Express', transitDays: 2, base: 61, perLb: 5.4, international: true },
    {
      code: '54',
      name: 'UPS Worldwide Express Plus',
      transitDays: 1,
      base: 89,
      perLb: 6.1,
      international: true,
    },
    {
      code: '72',
      name: 'UPS Worldwide Economy DDP',
      transitDays: 8,
      base: 26,
      perLb: 2.6,
      international: true,
    },
    {
      code: '17',
      name: 'UPS Worldwide Economy DDU',
      transitDays: 8,
      base: 24,
      perLb: 2.4,
      international: true,
    },
    { code: '74', name: 'UPS Express 12:00', transitDays: 1, base: 74, perLb: 5.8, international: true },
    { code: 'M2', name: 'UPS First Class Mail', transitDays: 5, base: 4.4, perLb: 0.9 },
    { code: 'M3', name: 'UPS Priority Mail', transitDays: 3, base: 7.9, perLb: 0.8 },
    { code: 'M4', name: 'UPS Expedited Mail Innovations', transitDays: 4, base: 5.6, perLb: 0.6 },
    {
      code: 'M5',
      name: 'UPS Priority Mail Innovations',
      transitDays: 6,
      base: 9.4,
      perLb: 1.1,
      international: true,
    },
    {
      code: 'M6',
      name: 'UPS Economy Mail Innovations',
      transitDays: 10,
      base: 7.2,
      perLb: 0.9,
      international: true,
    },
  ],
  packages: [
    { code: '02', name: 'Customer Supplied Package' },
    { code: '01', name: 'UPS Letter' },
    { code: '03', name: 'Tube' },
    { code: '04', name: 'PAK' },
    { code: '21', name: 'UPS Express Box' },
    { code: '2a', name: 'Small Express Box' },
    { code: '2b', name: 'Medium Express Box' },
    { code: '2c', name: 'Large Express Box' },
    { code: '24', name: 'UPS 25KG Box' },
    { code: '25', name: 'UPS 10KG Box' },
    { code: '30', name: 'Pallet' },
    { code: '56', name: 'Flats' },
    { code: '57', name: 'Parcels' },
    { code: '58', name: 'BPM' },
    { code: '59', name: 'First Class' },
    { code: '60', name: 'Priority' },
    { code: '61', name: 'Machineables' },
    { code: '62', name: 'Irregulars' },
    { code: '63', name: 'Parcel Post' },
    { code: '64', name: 'BPM Parcel' },
    { code: '65', name: 'Media Mail' },
    { code: '66', name: 'BPM Flat' },
    { code: '67', name: 'Standard Flat' },
  ],
  validateRequest: (from, to, packages) => {
    validate(from, to);
    assertPackages(packages);
  },
  live: {
    async validate(creds, env) {
      await token(env, creds);
      return 'UPS accepted these credentials';
    },
    async rate(req, creds) {
      const t = await token(req.connection.environment, creds);
      const body = await carrierFetch(`${host(req.connection.environment)}/api/rating/v2403/Shop`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${t}`,
          'content-type': 'application/json',
          transId: crypto.randomUUID(),
          transactionSrc: 'KitStak',
        },
        body: JSON.stringify({
          RateRequest: {
            Request: { RequestOption: 'Shop' },
            Shipment: {
              Shipper: { ...addr(req.from), ShipperNumber: req.connection.payorAccountNumber ?? '' },
              ShipTo: addr(req.to),
              ShipFrom: addr(req.from),
              Package: pkgs(req),
            },
          },
        }),
      });
      const rated = ((body.RateResponse as Record<string, unknown> | undefined)?.RatedShipment ??
        []) as Record<string, unknown>[];
      return (Array.isArray(rated) ? rated : [rated]).flatMap((r) => {
        const code = String((r.Service as Record<string, unknown>)?.Code ?? '');
        const svc = req.services.find((s) => s.serviceCode === code);
        if (!svc) return [];
        const total = (r.TotalCharges as Record<string, unknown>) ?? {};
        return [
          {
            carrierServiceId: svc.id,
            serviceCode: code,
            serviceName: svc.name,
            carrierCode: 'UPS',
            amount: Number(total.MonetaryValue ?? 0),
            currency: String(total.CurrencyCode ?? 'USD'),
            transitDays: svc.transitDays,
            zone: '',
            estimatedDeliveryAt: new Date(Date.now() + svc.transitDays * 86_400_000).toISOString(),
          },
        ];
      });
    },
    async createLabel(req: LabelRequest, creds) {
      const t = await token(req.connection.environment, creds);
      const body = await carrierFetch(`${host(req.connection.environment)}/api/shipments/v2403/ship`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${t}`,
          'content-type': 'application/json',
          transId: crypto.randomUUID(),
          transactionSrc: 'KitStak',
        },
        body: JSON.stringify({
          ShipmentRequest: {
            Request: { RequestOption: 'nonvalidate' },
            Shipment: {
              Description: req.orderCode,
              Shipper: { ...addr(req.from), ShipperNumber: req.connection.payorAccountNumber ?? '' },
              ShipTo: addr(req.to),
              ShipFrom: addr(req.from),
              PaymentInformation: {
                ShipmentCharge: {
                  Type: '01',
                  BillShipper: { AccountNumber: req.connection.payorAccountNumber ?? '' },
                },
              },
              Service: { Code: req.service.serviceCode },
              Package: pkgs(req),
              ReferenceNumber: { Value: req.orderCode },
            },
            LabelSpecification: {
              LabelImageFormat: { Code: req.format === 'PDF' ? 'GIF' : req.format },
              LabelStockSize: { Height: '6', Width: '4' },
            },
          },
        }),
      });
      const results = ((body.ShipmentResponse as Record<string, unknown>)?.ShipmentResults ?? {}) as Record<
        string,
        unknown
      >;
      const pkgResults = (
        Array.isArray(results.PackageResults) ? results.PackageResults : [results.PackageResults]
      ) as Record<string, unknown>[];
      const packages = pkgResults.map((p) => ({
        trackingNumber: String(p.TrackingNumber ?? ''),
        amount: 0,
        label: Buffer.from(
          String((p.ShippingLabel as Record<string, unknown>)?.GraphicImage ?? ''),
          'base64',
        ),
      }));
      const total = Number(
        ((results.ShipmentCharges as Record<string, unknown>)?.TotalCharges as Record<string, unknown>)
          ?.MonetaryValue ?? 0,
      );
      return {
        masterTrackingNumber: String(
          results.ShipmentIdentificationNumber ?? packages[0]?.trackingNumber ?? '',
        ),
        packages,
        totalAmount: total,
        currency: 'USD',
        zone: '',
        estimatedDeliveryAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        format: req.format === 'PDF' ? 'PDF' : 'ZPL',
      };
    },
    async voidLabel(req, creds) {
      const t = await token(req.connection.environment, creds);
      await carrierFetch(
        `${host(req.connection.environment)}/api/shipments/v2403/void/cancel/${encodeURIComponent(req.trackingNumber)}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${t}`, transId: crypto.randomUUID(), transactionSrc: 'KitStak' },
        },
      );
      return { voided: true };
    },
  },
};

export const upsAdapter = buildCarrierAdapter(UPS_DEF);

/** FedEx adapter (M12): OAuth + Rate / Ship / Cancel APIs; Test env = validated simulation. */
import { CarrierError, type CarrierAddress } from '@/server/domain/carriers/adapter';
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
  env === 'Production' ? 'https://apis.fedex.com' : 'https://apis-sandbox.fedex.com';

async function token(env: string, creds: Credentials): Promise<string> {
  const body = await carrierFetch(`${host(env)}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: need(creds, 'apiKey', 'API key'),
      client_secret: need(creds, 'apiSecret', 'Secret key'),
    }).toString(),
  });
  if (typeof body.access_token !== 'string')
    throw new CarrierError('FedEx did not return an access token', 401);
  return body.access_token;
}

const party = (a: CarrierAddress) => ({
  contact: { personName: a.name, phoneNumber: phoneDigits(a.phone), companyName: a.company ?? undefined },
  address: {
    streetLines: [a.line1, a.line2].filter(Boolean),
    city: a.city,
    stateOrProvinceCode: a.state ?? '',
    postalCode: a.postalCode,
    countryCode: a.country.length === 2 ? a.country : 'US',
  },
});

export const FEDEX_DEF: CarrierDef = {
  provider: 'fedex',
  carrierCode: 'FEDEX',
  trackingPrefix: '7',
  trackingLength: 11,
  credentialFields: [
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'apiSecret', label: 'Secret key', secret: true },
  ],
  services: [
    { code: 'FEDEX_GROUND', name: 'FedEx Ground', transitDays: 5, base: 9.1, perLb: 0.66 },
    { code: 'GROUND_HOME_DELIVERY', name: 'FedEx Home Delivery', transitDays: 5, base: 9.6, perLb: 0.68 },
    { code: 'FEDEX_EXPRESS_SAVER', name: 'FedEx Express Saver', transitDays: 3, base: 14.2, perLb: 1.1 },
    { code: 'FEDEX_2_DAY', name: 'FedEx 2Day', transitDays: 2, base: 17.1, perLb: 1.4 },
    { code: 'STANDARD_OVERNIGHT', name: 'FedEx Standard Overnight', transitDays: 1, base: 28.4, perLb: 2.2 },
    { code: 'PRIORITY_OVERNIGHT', name: 'FedEx Priority Overnight', transitDays: 1, base: 32.5, perLb: 2.5 },
    {
      code: 'INTERNATIONAL_ECONOMY',
      name: 'FedEx International Economy',
      transitDays: 5,
      base: 41,
      perLb: 4,
      international: true,
    },
    {
      code: 'INTERNATIONAL_PRIORITY',
      name: 'FedEx International Priority',
      transitDays: 3,
      base: 58,
      perLb: 5.2,
      international: true,
    },
  ],
  packages: [
    { code: 'YOUR_PACKAGING', name: 'Your Packaging' },
    { code: 'FEDEX_ENVELOPE', name: 'FedEx Envelope' },
    { code: 'FEDEX_PAK', name: 'FedEx Pak' },
    { code: 'FEDEX_SMALL_BOX', name: 'FedEx Small Box' },
    { code: 'FEDEX_MEDIUM_BOX', name: 'FedEx Medium Box' },
    { code: 'FEDEX_LARGE_BOX', name: 'FedEx Large Box' },
    { code: 'FEDEX_TUBE', name: 'FedEx Tube' },
  ],
  validateRequest(from, to, packages) {
    if (phoneDigits(from.phone).length !== 10 && phoneDigits(from.phone).length < 10)
      throw new CarrierError('SHIPPER.PHONENUMBER.INVALID: Shipper phone number must be 10 digits', 400);
    if (!to.postalCode)
      throw new CarrierError('RECIPIENT.POSTALCODE.INVALID: Recipient postal code is required', 400);
    assertPackages(packages);
    if (packages.some((p) => p.weightOz > 150 * 16))
      throw new CarrierError('PACKAGE.WEIGHT.EXCEEDED: Package weight exceeds 150 lb', 400);
  },
  live: {
    async validate(creds, env) {
      await token(env, creds);
      return 'FedEx accepted these credentials';
    },
    async rate(req, creds) {
      const t = await token(req.connection.environment, creds);
      const body = await carrierFetch(`${host(req.connection.environment)}/rate/v1/rates/quotes`, {
        method: 'POST',
        headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          accountNumber: { value: req.connection.payorAccountNumber ?? '' },
          requestedShipment: {
            shipper: party(req.from),
            recipient: party(req.to),
            pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
            rateRequestType: ['ACCOUNT'],
            requestedPackageLineItems: req.packages.map((p) => ({
              weight: { units: 'LB', value: Math.max(0.1, p.weightOz / 16) },
              dimensions: { length: p.length, width: p.width, height: p.height, units: 'IN' },
            })),
          },
        }),
      });
      const details = ((body.output as Record<string, unknown>)?.rateReplyDetails ?? []) as Record<
        string,
        unknown
      >[];
      return details.flatMap((d) => {
        const svc = req.services.find((s) => s.serviceCode === d.serviceType);
        const rated = ((d.ratedShipmentDetails as Record<string, unknown>[] | undefined) ?? [])[0];
        if (!svc || !rated) return [];
        return [
          {
            carrierServiceId: svc.id,
            serviceCode: svc.serviceCode,
            serviceName: svc.name,
            carrierCode: 'FEDEX',
            amount: Number(rated.totalNetCharge ?? 0),
            currency: 'USD',
            transitDays: svc.transitDays,
            zone: '',
            estimatedDeliveryAt: new Date(Date.now() + svc.transitDays * 86_400_000).toISOString(),
          },
        ];
      });
    },
    async createLabel(req, creds) {
      const t = await token(req.connection.environment, creds);
      const body = await carrierFetch(`${host(req.connection.environment)}/ship/v1/shipments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          labelResponseOptions: 'LABEL',
          accountNumber: { value: req.connection.payorAccountNumber ?? '' },
          requestedShipment: {
            shipper: party(req.from),
            recipients: [party(req.to)],
            serviceType: req.service.serviceCode,
            packagingType: 'YOUR_PACKAGING',
            pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
            shippingChargesPayment: { paymentType: 'SENDER' },
            labelSpecification: {
              imageType: req.format === 'PDF' ? 'PDF' : 'ZPLII',
              labelStockType: 'STOCK_4X6',
            },
            requestedPackageLineItems: req.packages.map((p) => ({
              weight: { units: 'LB', value: Math.max(0.1, p.weightOz / 16) },
              customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: req.orderCode }],
            })),
          },
        }),
      });
      const shipment = ((((body.output as Record<string, unknown>)?.transactionShipments as
        Record<string, unknown>[] | undefined) ?? [])[0] ?? {}) as Record<string, unknown>;
      const pieces = (shipment.pieceResponses as Record<string, unknown>[] | undefined) ?? [];
      const packages = pieces.map((p) => ({
        trackingNumber: String(p.trackingNumber ?? ''),
        amount: 0,
        label: Buffer.from(
          String(
            ((p.packageDocuments as Record<string, unknown>[] | undefined) ?? [])[0]?.encodedLabel ?? '',
          ),
          'base64',
        ),
      }));
      return {
        masterTrackingNumber: String(shipment.masterTrackingNumber ?? packages[0]?.trackingNumber ?? ''),
        packages,
        totalAmount: 0,
        currency: 'USD',
        zone: '',
        estimatedDeliveryAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        format: req.format === 'PDF' ? 'PDF' : 'ZPL',
      };
    },
    async voidLabel(req, creds) {
      const t = await token(req.connection.environment, creds);
      await carrierFetch(`${host(req.connection.environment)}/ship/v1/shipments/cancel`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          accountNumber: { value: req.connection.payorAccountNumber ?? '' },
          trackingNumber: req.trackingNumber,
        }),
      });
      return { voided: true };
    },
  },
};

export const fedexAdapter = buildCarrierAdapter(FEDEX_DEF);

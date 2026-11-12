/** EasyPost adapter (M12): API key (Basic auth) + Shipments / Buy / Refund; Test env = validated simulation. */
import { CarrierError, type CarrierAddress, type LabelRequest } from '@/server/domain/carriers/adapter';
import { assertPackages, buildCarrierAdapter, carrierFetch, need, type CarrierDef } from './common';
import type { Credentials } from '../crypto';

const BASE = 'https://api.easypost.com/v2';
const auth = (creds: Credentials) =>
  `Basic ${Buffer.from(`${need(creds, 'apiKey', 'API key')}:`).toString('base64')}`;
const ep = (a: CarrierAddress) => ({
  name: a.name,
  company: a.company ?? undefined,
  street1: a.line1,
  street2: a.line2 ?? undefined,
  city: a.city,
  state: a.state ?? undefined,
  zip: a.postalCode,
  country: a.country.length === 2 ? a.country : 'US',
  phone: a.phone ?? undefined,
});

async function shipment(
  req: Pick<LabelRequest, 'from' | 'to' | 'packages' | 'orderCode'>,
  creds: Credentials,
) {
  const p = req.packages[0];
  if (!p) throw new CarrierError('At least one package is required.', 400);
  return carrierFetch(`${BASE}/shipments`, {
    method: 'POST',
    headers: { authorization: auth(creds), 'content-type': 'application/json' },
    body: JSON.stringify({
      shipment: {
        reference: req.orderCode,
        from_address: ep(req.from),
        to_address: ep(req.to),
        parcel: { length: p.length, width: p.width, height: p.height, weight: p.weightOz },
      },
    }),
  });
}

export const EASYPOST_DEF: CarrierDef = {
  provider: 'easypost',
  carrierCode: 'USPS',
  trackingPrefix: '9405',
  trackingLength: 18,
  credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
  services: [
    { code: 'GroundAdvantage', name: 'USPS Ground Advantage', transitDays: 5, base: 4.9, perLb: 0.44 },
    { code: 'Priority', name: 'USPS Priority Mail', transitDays: 3, base: 8.1, perLb: 0.58 },
    { code: 'Express', name: 'USPS Priority Mail Express', transitDays: 1, base: 28.75, perLb: 1.9 },
    {
      code: 'FirstClassPackageInternationalService',
      name: 'USPS First-Class Package International',
      transitDays: 10,
      base: 16.5,
      perLb: 3.1,
      international: true,
    },
  ],
  packages: [
    { code: 'Parcel', name: 'Parcel' },
    { code: 'FlatRateEnvelope', name: 'Flat Rate Envelope' },
    { code: 'SmallFlatRateBox', name: 'Small Flat Rate Box' },
    { code: 'MediumFlatRateBox', name: 'Medium Flat Rate Box' },
    { code: 'LargeFlatRateBox', name: 'Large Flat Rate Box' },
  ],
  validateRequest(from, to, packages) {
    if (!from.line1 || !from.postalCode)
      throw new CarrierError('ADDRESS.VERIFY.FAILURE: from_address is incomplete', 422);
    if (!to.postalCode) throw new CarrierError('ADDRESS.VERIFY.FAILURE: to_address zip is required', 422);
    assertPackages(packages);
    if (packages.some((p) => p.weightOz > 70 * 16))
      throw new CarrierError('SHIPMENT.POSTAGE.FAILURE: USPS parcels can weigh at most 70 lb', 422);
  },
  live: {
    async validate(creds) {
      await carrierFetch(`${BASE}/addresses?page_size=1`, { headers: { authorization: auth(creds) } });
      return 'EasyPost accepted this API key';
    },
    async rate(req, creds) {
      const body = await shipment({ ...req, orderCode: 'rate' }, creds);
      const rates = (body.rates as Record<string, unknown>[] | undefined) ?? [];
      return rates.flatMap((r) => {
        const svc = req.services.find((s) => s.serviceCode === r.service);
        return svc
          ? [
              {
                carrierServiceId: svc.id,
                serviceCode: svc.serviceCode,
                serviceName: svc.name,
                carrierCode: String(r.carrier ?? 'USPS'),
                amount: Number(r.rate ?? 0),
                currency: String(r.currency ?? 'USD'),
                transitDays: Number(r.delivery_days ?? svc.transitDays),
                zone: '',
                estimatedDeliveryAt: String(
                  r.delivery_date ?? new Date(Date.now() + svc.transitDays * 86_400_000).toISOString(),
                ),
              },
            ]
          : [];
      });
    },
    async createLabel(req, creds) {
      const s = await shipment(req, creds);
      const rate = ((s.rates as Record<string, unknown>[] | undefined) ?? []).find(
        (r) => r.service === req.service.serviceCode,
      );
      if (!rate) throw new CarrierError(`EasyPost did not offer ${req.service.name} for this shipment`, 422);
      const bought = await carrierFetch(`${BASE}/shipments/${String(s.id)}/buy`, {
        method: 'POST',
        headers: { authorization: auth(creds), 'content-type': 'application/json' },
        body: JSON.stringify({ rate: { id: rate.id }, label_format: req.format === 'PDF' ? 'PDF' : 'ZPL' }),
      });
      const label = (bought.postage_label as Record<string, unknown>) ?? {};
      const url = String(label.label_pdf_url ?? label.label_zpl_url ?? label.label_url ?? '');
      const bytes = url ? new Uint8Array(await (await fetch(url)).arrayBuffer()) : new Uint8Array();
      const tracking = String(bought.tracking_code ?? '');
      return {
        masterTrackingNumber: tracking,
        packages: [{ trackingNumber: tracking, amount: Number(rate.rate ?? 0), label: bytes }],
        totalAmount: Number(rate.rate ?? 0),
        currency: 'USD',
        zone: '',
        estimatedDeliveryAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        format: req.format === 'PDF' ? 'PDF' : 'ZPL',
      };
    },
    async voidLabel(req, creds) {
      await carrierFetch(`${BASE}/refunds`, {
        method: 'POST',
        headers: { authorization: auth(creds), 'content-type': 'application/json' },
        body: JSON.stringify({ refund: { carrier: 'USPS', tracking_codes: [req.trackingNumber] } }),
      });
      return { voided: true };
    },
  },
};

export const easypostAdapter = buildCarrierAdapter(EASYPOST_DEF);

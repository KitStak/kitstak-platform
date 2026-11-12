/**
 * Custom Carrier (M12): your own fleet, a regional courier or an LTL partner with no API.
 * Rates come from the configured service table, labels are rendered by KitStak with a "CC"
 * tracking number (or the number the operator types at ship time), and voids are local.
 * No credentials are needed, so the same behaviour applies in Test and Production.
 */
import { CarrierError } from '@/server/domain/carriers/adapter';
import { assertPackages, buildCarrierAdapter, type CarrierDef } from './common';

export const CUSTOM_DEF: CarrierDef = {
  provider: 'custom',
  carrierCode: 'CUSTOM',
  trackingPrefix: 'CC',
  trackingLength: 12,
  credentialFields: [],
  services: [
    { code: 'STD', name: 'Custom Standard', transitDays: 4, base: 7.5, perLb: 0.55 },
    { code: 'EXP', name: 'Custom Express', transitDays: 2, base: 14, perLb: 1.1 },
    { code: 'NDA', name: 'Custom Next Day', transitDays: 1, base: 24, perLb: 1.8 },
    { code: 'LOC', name: 'Local Delivery', transitDays: 1, base: 9, perLb: 0.25 },
    { code: 'WGT', name: 'White Glove', transitDays: 5, base: 65, perLb: 0.9 },
    { code: 'LTL', name: 'LTL Freight', transitDays: 6, base: 120, perLb: 0.18 },
    { code: 'INT', name: 'Custom International', transitDays: 8, base: 38, perLb: 3.2, international: true },
  ],
  packages: [
    { code: 'BOX', name: 'Box' },
    { code: 'POLY', name: 'Poly Mailer' },
    { code: 'ENV', name: 'Envelope' },
    { code: 'PLT', name: 'Pallet' },
    { code: 'CRATE', name: 'Crate' },
  ],
  validateRequest: (from, to, packages) => {
    assertPackages(packages);
    if (!from.postalCode) throw new CarrierError('Ship-from postal code is required', 400);
    if (!to.postalCode || !to.line1)
      throw new CarrierError('Ship-to address line 1 and postal code are required', 400);
  },
  // No external API: "live" is the same local implementation, so Production never fails on credentials.
  live: {
    async validate() {
      return 'Custom carrier ready (no credentials needed)';
    },
    async rate() {
      throw new CarrierError('Custom carrier rates are computed locally', 400);
    },
    async createLabel() {
      throw new CarrierError('Custom carrier labels are rendered locally', 400);
    },
    async voidLabel() {
      return { voided: true };
    },
  },
};

export const customAdapter = buildCarrierAdapter(CUSTOM_DEF);

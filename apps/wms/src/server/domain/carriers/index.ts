/** Carrier adapters. Importing this module registers the KitStak Sandbox adapter. */
export * from './adapter';
export * from './label';
export * from './sandbox';
// Registers M12's carrier adapters (ups, fedex, easypost, shippo) wherever carriers are resolved
// (docs/requests/automation-integrations.md REQ-5). Last, so the registry above is ready first.
import '@/server/integrations/carriers';

/**
 * Address verification (BUILD_PLAN F5): normalises the state (Arkansas -> AR), merges
 * address line 2 into line 1 (Logiwa parity), flags PO boxes and military addresses, and
 * returns notes plus a status. `verifyWithCarrier()` layers a carrier's `validateAddress`.
 */
import type { ADDRESS_VERIFICATION_STATUSES } from "@/lib/enums";

export type AddressVerificationStatus = (typeof ADDRESS_VERIFICATION_STATUSES)[number];

export interface AddressInput {
  readonly line1: string;
  readonly line2?: string | null;
  readonly city: string;
  readonly state?: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface NormalizedAddress {
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface AddressCheck {
  readonly status: AddressVerificationStatus;
  readonly notes: readonly string[];
  readonly normalized: NormalizedAddress;
  readonly isPoBox: boolean;
  readonly isMilitary: boolean;
}

export const US_STATES: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR", guam: "GU", "virgin islands": "VI", "american samoa": "AS", "northern mariana islands": "MP",
  "armed forces americas": "AA", "armed forces europe": "AE", "armed forces pacific": "AP",
};

const STATE_CODES = new Set(Object.values(US_STATES));
const MILITARY_STATES = new Set(["AA", "AE", "AP"]);
const US_ALIASES = new Set(["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america", "america"]);
const PO_BOX_RE = /\b(p\.?\s*o\.?\s*box|post\s+office\s+box|pob\s+\d|box\s+\d+$)/i;
const MILITARY_CITY_RE = /^(apo|fpo|dpo)$/i;
const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

export function normalizeCountry(country: string): string {
  return US_ALIASES.has(clean(country).toLowerCase()) ? "United States" : clean(country);
}

export function normalizeState(state: string | null | undefined): string | null {
  const s = clean(state);
  if (!s) return null;
  const upper = s.toUpperCase().replace(/\./g, "");
  if (STATE_CODES.has(upper)) return upper;
  return US_STATES[s.toLowerCase()] ?? s;
}

/** Pure, offline verification. */
export function verifyAddress(input: AddressInput): AddressCheck {
  const notes: string[] = [];
  const country = normalizeCountry(input.country);
  const isUs = country === "United States";
  const line2 = clean(input.line2);
  const line1 = line2 ? `${clean(input.line1)} ${line2}` : clean(input.line1);
  if (line2) notes.push("Address line 2 was merged into address line 1.");
  const rawState = clean(input.state);
  const state = isUs ? normalizeState(rawState) : rawState || null;
  if (isUs && state && rawState && state !== rawState) notes.push(`State was normalized from "${rawState}" to "${state}".`);
  const postalCode = clean(input.postalCode);
  const city = clean(input.city);
  const normalized: NormalizedAddress = { line1, line2: null, city, state, postalCode, country };
  const isPoBox = PO_BOX_RE.test(line1);
  const isMilitary = (state !== null && MILITARY_STATES.has(state)) || MILITARY_CITY_RE.test(city);
  if (isPoBox) notes.push("The address is a PO box; some carrier services can't deliver to PO boxes.");
  if (isMilitary) notes.push("The address is a military (APO/FPO/DPO) address.");

  const failures: string[] = [];
  if (!line1) failures.push("Address line 1 is missing.");
  if (!city) failures.push("City is missing.");
  if (!postalCode) failures.push("Zip code is missing.");
  if (isUs && postalCode && !US_ZIP_RE.test(postalCode)) failures.push(`Zip code "${postalCode}" is not a valid US zip code.`);
  if (isUs && !state) failures.push("State is missing.");
  if (isUs && state && !STATE_CODES.has(state)) failures.push(`State "${state}" is not a US state.`);
  if (failures.length > 0) return { status: "Failed", notes: [...notes, ...failures], normalized, isPoBox, isMilitary };
  const partial = isPoBox || isMilitary || !isUs;
  if (!isUs) notes.push("International addresses are only checked for completeness.");
  return { status: partial ? "Partially Verified" : "Verified", notes, normalized, isPoBox, isMilitary };
}

export interface AddressValidator {
  validateAddress(address: AddressInput): Promise<AddressCheck>;
}

/** Runs the offline checks, then the carrier's validator when the offline result is not Failed. */
export async function verifyWithCarrier(input: AddressInput, carrier?: AddressValidator): Promise<AddressCheck> {
  const local = verifyAddress(input);
  if (!carrier || local.status === "Failed") return local;
  const remote = await carrier.validateAddress(local.normalized);
  return { ...remote, notes: [...local.notes, ...remote.notes], isPoBox: local.isPoBox || remote.isPoBox, isMilitary: local.isMilitary || remote.isMilitary };
}

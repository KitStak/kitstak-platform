/**
 * Country data for phone / country cells: ISO 3166 alpha-2 code, English name, dial code.
 * Phone formatting groups the national number for readability (display only; values are
 * stored as typed, validated by the cell-value schema).
 */

export interface Country {
  readonly code: string;
  readonly name: string;
  readonly dial: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'US', name: 'United States', dial: '1' },
  { code: 'CA', name: 'Canada', dial: '1' },
  { code: 'GB', name: 'United Kingdom', dial: '44' },
  { code: 'IE', name: 'Ireland', dial: '353' },
  { code: 'AU', name: 'Australia', dial: '61' },
  { code: 'NZ', name: 'New Zealand', dial: '64' },
  { code: 'DE', name: 'Germany', dial: '49' },
  { code: 'FR', name: 'France', dial: '33' },
  { code: 'ES', name: 'Spain', dial: '34' },
  { code: 'PT', name: 'Portugal', dial: '351' },
  { code: 'IT', name: 'Italy', dial: '39' },
  { code: 'NL', name: 'Netherlands', dial: '31' },
  { code: 'BE', name: 'Belgium', dial: '32' },
  { code: 'CH', name: 'Switzerland', dial: '41' },
  { code: 'AT', name: 'Austria', dial: '43' },
  { code: 'SE', name: 'Sweden', dial: '46' },
  { code: 'NO', name: 'Norway', dial: '47' },
  { code: 'DK', name: 'Denmark', dial: '45' },
  { code: 'FI', name: 'Finland', dial: '358' },
  { code: 'PL', name: 'Poland', dial: '48' },
  { code: 'CZ', name: 'Czechia', dial: '420' },
  { code: 'GR', name: 'Greece', dial: '30' },
  { code: 'TR', name: 'Türkiye', dial: '90' },
  { code: 'IL', name: 'Israel', dial: '972' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966' },
  { code: 'EG', name: 'Egypt', dial: '20' },
  { code: 'ZA', name: 'South Africa', dial: '27' },
  { code: 'NG', name: 'Nigeria', dial: '234' },
  { code: 'KE', name: 'Kenya', dial: '254' },
  { code: 'IN', name: 'India', dial: '91' },
  { code: 'PK', name: 'Pakistan', dial: '92' },
  { code: 'SG', name: 'Singapore', dial: '65' },
  { code: 'MY', name: 'Malaysia', dial: '60' },
  { code: 'ID', name: 'Indonesia', dial: '62' },
  { code: 'PH', name: 'Philippines', dial: '63' },
  { code: 'TH', name: 'Thailand', dial: '66' },
  { code: 'VN', name: 'Vietnam', dial: '84' },
  { code: 'CN', name: 'China', dial: '86' },
  { code: 'HK', name: 'Hong Kong', dial: '852' },
  { code: 'TW', name: 'Taiwan', dial: '886' },
  { code: 'JP', name: 'Japan', dial: '81' },
  { code: 'KR', name: 'South Korea', dial: '82' },
  { code: 'MX', name: 'Mexico', dial: '52' },
  { code: 'BR', name: 'Brazil', dial: '55' },
  { code: 'AR', name: 'Argentina', dial: '54' },
  { code: 'CL', name: 'Chile', dial: '56' },
  { code: 'CO', name: 'Colombia', dial: '57' },
  { code: 'PE', name: 'Peru', dial: '51' },
  { code: 'UA', name: 'Ukraine', dial: '380' },
  { code: 'RO', name: 'Romania', dial: '40' },
  { code: 'HU', name: 'Hungary', dial: '36' },
];

const BY_CODE: ReadonlyMap<string, Country> = new Map(COUNTRIES.map((country) => [country.code, country]));

export function countryByCode(code: unknown): Country | undefined {
  return typeof code === 'string' ? BY_CODE.get(code.toUpperCase()) : undefined;
}

/** Regional-indicator emoji for a 2-letter code ("US" → 🇺🇸). */
export function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

export function searchCountries(query: string): Country[] {
  const needle = query.trim().toLowerCase().replace(/^\+/, '');
  if (!needle) return [...COUNTRIES];
  return COUNTRIES.filter(
    (country) =>
      country.name.toLowerCase().includes(needle) ||
      country.code.toLowerCase() === needle ||
      country.dial.startsWith(needle),
  );
}

/** Country whose dial code is the longest prefix of an international number ("+44..." → GB). */
export function countryFromNumber(phone: string, preferred?: string): Country | undefined {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return countryByCode(preferred);
  const body = digits.slice(1);
  const preferredCountry = countryByCode(preferred);
  if (preferredCountry && body.startsWith(preferredCountry.dial)) return preferredCountry;
  let best: Country | undefined;
  for (const country of COUNTRIES) {
    if (body.startsWith(country.dial) && (!best || country.dial.length > best.dial.length)) best = country;
  }
  return best;
}

function group(digits: string, sizes: readonly number[]): string {
  const parts: string[] = [];
  let index = 0;
  for (const size of sizes) {
    if (index >= digits.length) break;
    parts.push(digits.slice(index, index + size));
    index += size;
  }
  if (index < digits.length) parts.push(digits.slice(index));
  return parts.join(' ');
}

/** "+12145550163" → "+1 214 555 0163"; national numbers get the country's dial code prefix. */
export function formatPhone(phone: string, countryCode?: string): string {
  const trimmed = phone.trim();
  const international = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 4) return trimmed;
  const country = international ? countryFromNumber(trimmed, countryCode) : countryByCode(countryCode);
  if (!country) return international ? `+${group(digits, [3, 3, 4])}` : group(digits, [3, 3, 4]);
  const national = international ? digits.slice(country.dial.length) : digits.replace(/^0/, '');
  return `+${country.dial} ${group(national, nationalGroups(country.dial, national))}`;
}

/** Digit grouping for a national number (London-style 2-4-4, NANP 3-3-4, else 3-3-4 / 3-3-3). */
function nationalGroups(dial: string, national: string): number[] {
  if (dial === '1') return [3, 3, 4];
  if (dial === '44' && national.startsWith('2') && national.length === 10) return [2, 4, 4];
  if (national.length >= 10) return [3, 3, 4];
  return [3, 3, 3];
}

/**
 * National format without the country code (the flag already shows the country): US/CA
 * "214 555 0163", elsewhere with the trunk 0 ("020 7946 0958"). Used when the column is narrow.
 */
export function formatPhoneNational(phone: string, countryCode?: string): string {
  const trimmed = phone.trim();
  const international = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 4) return trimmed;
  const country = international ? countryFromNumber(trimmed, countryCode) : countryByCode(countryCode);
  if (!country) return formatPhone(phone, countryCode);
  const national = international ? digits.slice(country.dial.length) : digits.replace(/^0/, '');
  const grouped = group(national, nationalGroups(country.dial, national));
  return country.dial === '1' ? grouped : `0${grouped}`;
}

/** E.164-ish value for `tel:` links. */
export function telHref(phone: string, countryCode?: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `tel:+${digits}`;
  const country = countryByCode(countryCode);
  return country ? `tel:+${country.dial}${digits.replace(/^0/, '')}` : `tel:${digits}`;
}

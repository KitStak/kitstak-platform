/** ISO 3166 country codes for the billing address. Names come from `Intl.DisplayNames`, so no list of names is kept here. */
const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

export interface CountryOption {
  readonly code: string;
  readonly name: string;
}

/** Countries by name, with the United States first because most customers are there. */
export function countryOptions(): CountryOption[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const all = CODES.split(' ')
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const us = all.find((entry) => entry.code === 'US');
  return us ? [us, ...all.filter((entry) => entry.code !== 'US')] : all;
}

/** Tax ID types a customer can pick. The values are the ones Stripe uses. */
export const TAX_ID_TYPES: readonly { readonly value: string; readonly label: string; readonly example: string }[] = [
  { value: 'us_ein', label: 'United States EIN', example: '12-3456789' },
  { value: 'ca_bn', label: 'Canada BN', example: '123456789' },
  { value: 'ca_gst_hst', label: 'Canada GST or HST number', example: '123456789RT0002' },
  { value: 'eu_vat', label: 'European Union VAT number', example: 'DE123456789' },
  { value: 'gb_vat', label: 'United Kingdom VAT number', example: 'GB123456789' },
  { value: 'au_abn', label: 'Australia ABN', example: '12345678912' },
  { value: 'nz_gst', label: 'New Zealand GST number', example: '123456789' },
  { value: 'mx_rfc', label: 'Mexico RFC', example: 'ABC010203AB9' },
  { value: 'br_cnpj', label: 'Brazil CNPJ', example: '01.234.456/5432-10' },
  { value: 'in_gst', label: 'India GSTIN', example: '12ABCDE3456FGZH' },
  { value: 'sg_gst', label: 'Singapore GST number', example: 'M12345678X' },
  { value: 'ch_vat', label: 'Switzerland VAT number', example: 'CHE-123.456.789 MWST' },
  { value: 'no_vat', label: 'Norway VAT number', example: '123456789MVA' },
  { value: 'jp_cn', label: 'Japan corporate number', example: '1234567891234' },
  { value: 'za_vat', label: 'South Africa VAT number', example: '4123456789' },
];

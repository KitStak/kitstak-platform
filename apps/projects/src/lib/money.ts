/**
 * The one money format in Projects: whole units in a fixed en-US locale, so the server render and
 * the browser always agree (an undefined locale formats differently in Node ICU and Chromium,
 * which broke hydration on the Customer 360 strip). "$420,000", "€12,500"; an unknown currency
 * code falls back to "120,000 XYZ".
 */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  const code = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString('en-US')} ${code}`;
  }
}

/**
 * Lot/batch number rule shared by the inventory drawers and APIs: letters, digits, space and
 * . _ - / #, starting with a letter or digit, at most 60 characters. Keeps labels, scanners and
 * exports safe (no markup, quotes or control characters).
 */
export const LOT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/# ]{0,59}$/;
export const LOT_MESSAGE = 'Use letters, digits, spaces and . _ - / # (max 60, start with a letter or digit)';
export const isValidLot = (v: string): boolean => LOT_PATTERN.test(v.trim());

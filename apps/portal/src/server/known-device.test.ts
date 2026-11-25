import { describe, expect, it } from 'vitest';
import { KNOWN_DEVICE_COOKIE, knownDeviceUserIds, knownDeviceValue } from './known-device';

const SECRET = 'test-secret-test-secret-test-secret-0001';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function header(value: string): string {
  return `kitstak.session_token=abc; ${KNOWN_DEVICE_COOKIE}=${encodeURIComponent(value)}; kitstak-theme=dark`;
}

describe('the known device cookie (review round 5)', () => {
  it('reads back the people it was signed for', () => {
    expect(knownDeviceUserIds(header(knownDeviceValue(SECRET, [A, B])), SECRET)).toEqual([A, B]);
    expect(knownDeviceUserIds(`${KNOWN_DEVICE_COOKIE}=${knownDeviceValue(SECRET, [A])}`, SECRET)).toEqual([A]);
  });

  it('is empty with no cookie, another secret, or a changed value', () => {
    const value = knownDeviceValue(SECRET, [A]);
    expect(knownDeviceUserIds(null, SECRET)).toEqual([]);
    expect(knownDeviceUserIds('kitstak-theme=dark', SECRET)).toEqual([]);
    expect(knownDeviceUserIds(header(value), 'another-secret-another-secret-0000001')).toEqual([]);
    // A stranger who knows the victim's id can not make the cookie up.
    expect(knownDeviceUserIds(header(value.replace(A, B)), SECRET)).toEqual([]);
    expect(knownDeviceUserIds(header(`${B}.${value.split('.').pop() ?? ''}`), SECRET)).toEqual([]);
    expect(knownDeviceUserIds(header(`${A}.`), SECRET)).toEqual([]);
    expect(knownDeviceUserIds(header(A), SECRET)).toEqual([]);
    expect(knownDeviceUserIds(header('%E0%A4%A'), SECRET)).toEqual([]);
    expect(knownDeviceUserIds(header(value), '')).toEqual([]);
  });

  it('keeps at most five people and drops anything that is not an id', () => {
    const many = Array.from({ length: 8 }, (_, i) => `${i}${A.slice(1)}`);
    const value = knownDeviceValue(SECRET, [...many, 'not-an-id']);
    expect(knownDeviceUserIds(header(value), SECRET)).toEqual(many.slice(0, 5));
  });
});

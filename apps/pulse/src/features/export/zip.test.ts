import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, zip } from './zip';

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('zip', () => {
  it('computes the standard checksum', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('starts and ends like a zip file and lists every file once', () => {
    const bytes = zip([
      { name: 'clients.csv', content: 'client_code,name\r\nACME,Acme\r\n' },
      { name: 'clients.csv', content: 'again' },
    ]);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...bytes.slice(bytes.length - 22, bytes.length - 18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('clients.csv');
    expect(text).toContain('clients-2.csv');
  });

  it.skipIf(!hasUnzip())('is read back by unzip with the same bytes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pulse-zip-'));
    try {
      const body = `﻿note\r\n"Crème brûlée, 5 kits"\r\n${'row,'.repeat(5000)}\r\n`;
      writeFileSync(path.join(dir, 'all.zip'), zip([{ name: 'streams/costs.csv', content: body }, { name: 'READ ME.txt', content: 'hello' }]));
      execFileSync('unzip', ['-q', 'all.zip'], { cwd: dir });
      expect(readFileSync(path.join(dir, 'streams/costs.csv'), 'utf8')).toBe(body);
      expect(readFileSync(path.join(dir, 'READ ME.txt'), 'utf8')).toBe('hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

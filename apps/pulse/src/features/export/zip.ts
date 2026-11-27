/**
 * A tiny zip writer for "Download everything": a handful of CSV files in one archive, with no
 * dependency. Files are deflated with Node's zlib; names and text are UTF-8.
 */
import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** File name inside the archive. Folders use forward slashes. */
  readonly name: string;
  readonly content: string | Uint8Array;
}

let table: Uint32Array | null = null;

/** CRC-32 of a byte array (the checksum the zip format asks for). */
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = (table[(crc ^ (bytes[index] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Builds a zip archive in memory. */
export function zip(entries: readonly ZipEntry[], now: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const stamp = dosTime(now);
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    let name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    while (seen.has(name)) name = name.replace(/(\.[^.]*)?$/, (ext) => `-2${ext}`);
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const raw = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const packed = new Uint8Array(deflateRawSync(raw));
    const crc = crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 8, true); // deflate
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, packed);
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, 8, true);
    header.setUint16(12, stamp.time, true);
    header.setUint16(14, stamp.day, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, packed.length, true);
    header.setUint32(24, raw.length, true);
    header.setUint16(28, nameBytes.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...parts, ...central, new Uint8Array(end.buffer)]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

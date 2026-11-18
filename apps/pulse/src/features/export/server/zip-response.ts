/** A zip file download. Never cached, always saved as a file. */
import 'server-only';
import { NextResponse } from 'next/server';
import { zip, type ZipEntry } from '@/features/export/zip';

export function zipResponse(fileName: string, entries: readonly ZipEntry[]): NextResponse {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'export.zip';
  const bytes = zip(entries);
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safe}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

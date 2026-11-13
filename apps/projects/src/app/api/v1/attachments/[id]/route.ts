/**
 * Attachment download/preview. Access is checked on every read. Images/PDF/text render inline;
 * everything else downloads. Responses are private and never cached by shared caches.
 */
import { NextResponse } from 'next/server';
import { readAttachment, toDomainContext } from '@/server/domain';
import { errorResponse } from '@/server/http/api';
import { DomainError } from '@/server/errors';
import { getApiContext } from '@/server/session';

const INLINE = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|text\/plain|video\/(mp4|webm)|audio\/)/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext(request);
    if (!context) throw new DomainError('UNAUTHENTICATED', 'Sign in to KitStak to open this file.');
    const { id } = await params;
    const file = await readAttachment(toDomainContext(context), id);
    if (file.redirectUrl) return NextResponse.redirect(file.redirectUrl, 302);
    const download = new URL(request.url).searchParams.get('download') === '1' || !INLINE.test(file.contentType);
    const encoded = encodeURIComponent(file.name);
    return new NextResponse(new Uint8Array(file.bytes ?? Buffer.alloc(0)), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.sizeBytes),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

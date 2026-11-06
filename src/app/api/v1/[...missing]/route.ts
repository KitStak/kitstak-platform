/** Unknown `/api/v1/*` paths answer with the JSON error envelope instead of the HTML 404 page. */
import { NextResponse } from 'next/server';

function notFound(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: 'NOT_FOUND', message: 'No such API endpoint' } },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;

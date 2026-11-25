import { NextResponse } from 'next/server';
import { getInvoicePdf } from '@kitstak/billing/server';
import { getBillingContext } from '@/server/billing/context';

/**
 * GET /billing/invoices/<id>/pdf. Needs a session and the right to see billing. The invoice is
 * looked up inside the session's own organization before the gateway is asked, so another
 * organization's invoice is a plain 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ invoiceId: string }> }): Promise<Response> {
  const { invoiceId } = await params;
  const context = await getBillingContext();
  if (!context) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `/billing/invoices/${invoiceId}/pdf`);
    return NextResponse.redirect(login);
  }
  const notFound = () => new Response('We could not find that.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (!context.access.canView || !/^[A-Za-z0-9_]{4,200}$/.test(invoiceId)) return notFound();

  const result = await getInvoicePdf(context.rt, { orgId: context.org.id, invoiceId });
  if (!result.ok) {
    if (result.error.code === 'not_found') return notFound();
    return new Response(result.error.message, { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (result.data.kind === 'redirect') return NextResponse.redirect(result.data.url);
  const filename = result.data.filename.replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(new Uint8Array(result.data.bytes), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${filename}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

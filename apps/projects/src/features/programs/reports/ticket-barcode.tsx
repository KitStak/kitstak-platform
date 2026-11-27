'use client';
import { Barcode } from '../kit/barcode';

/** The Code 128 barcode on a build ticket (client: the kit atom draws SVG bars). */
export function TicketBarcode({ value }: { readonly value: string }) {
  return <Barcode value={value} height={52} module={1.6} className="max-w-full print:[&_rect]:fill-black" />;
}

/**
 * Read-only address card: name, formatted lines, contact, type and tax badges, with an
 * optional Edit action.
 */
import * as React from 'react';
import { Mail, MapPin, Pencil, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { countryName } from '@/lib/countries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatAddressLines, type Address } from './address-model';

export interface AddressCardProps {
  readonly title?: string;
  readonly address: Partial<Address> | null | undefined;
  readonly onEdit?: () => void;
  readonly className?: string;
}

export function AddressCard({ title = 'Address', address, onEdit, className }: AddressCardProps) {
  return (
    <section
      aria-label={title}
      className={cn('flex flex-col gap-2 rounded-lg border border-border bg-surface p-4', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-faint">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {title}
        </h3>
        {onEdit ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${title.toLowerCase()}`} onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
      {!address || !address.line1 ? (
        <p className="text-sm text-faint">No address on file</p>
      ) : (
        <>
          <p className="text-base font-semibold text-foreground">{address.name}</p>
          <address className="flex flex-col text-sm not-italic leading-5 text-body">
            {formatAddressLines({
              ...address,
              country: address.country ? countryName(address.country) : undefined,
            }).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </address>
          {address.phone || address.email ? (
            <div className="flex flex-col gap-0.5 text-xs text-secondary">
              {address.phone ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-3 w-3" aria-hidden />
                  {address.phone}
                </span>
              ) : null}
              {address.email ? (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3 w-3" aria-hidden />
                  {address.email}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {address.addressType ? (
              <Badge tone="neutral" size="sm">
                {address.addressType}
              </Badge>
            ) : null}
            {address.taxType && address.taxId ? (
              <Badge tone="info" size="sm">
                {address.taxType}: {address.taxId}
              </Badge>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

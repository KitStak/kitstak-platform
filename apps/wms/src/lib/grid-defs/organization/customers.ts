/** Customers (M11): grid fields (4 Logiwa filters + extras) and the drawer schema. PURE. */
import { z } from 'zod';
import { orgAddressSchema, requiredId, requiredText, versionField, type OrgField } from './common';

export const CUSTOMERS_GRID_KEY = 'customers';

export const CUSTOMER_FIELDS: readonly OrgField[] = [
  { field: 'isActive', label: 'Active', type: 'boolean' },
  { field: 'clientId', label: 'Client', type: 'enum' },
  { field: 'email', label: 'Email', type: 'text' },
  { field: 'fullName', label: 'Full name', type: 'text' },
  { field: 'city', label: 'City', type: 'text' },
  { field: 'state', label: 'State', type: 'text' },
  { field: 'country', label: 'Country', type: 'text' },
  { field: 'orderCount', label: 'Orders', type: 'number' },
  { field: 'createdAt', label: 'Created date', type: 'date' },
];
/** Customer list preset: Client, Full name, Email, Active. */
export const CUSTOMER_FILTER_PRESET = ['clientId', 'fullName', 'email', 'isActive'] as const;
export const CUSTOMER_SORT_FIELDS = [
  'fullName',
  'email',
  'phone',
  'clientName',
  'city',
  'country',
  'state',
  'isActive',
  'orderCount',
  'createdAt',
] as const;
export const CUSTOMER_SEARCH_FIELDS = ['fullName', 'email', 'phone'] as const;

export const customerSchema = z
  .object({
    firstName: requiredText('First name', 60),
    lastName: requiredText('Last name', 60),
    email: z
      .string({ error: 'E-mail is required' })
      .trim()
      .min(1, 'E-mail is required')
      .pipe(z.email('Enter a valid e-mail')),
    phone: requiredText('Phone', 40).regex(/^[0-9+().\-\s]{7,}$/, 'Enter a valid phone number'),
    clientId: requiredId('Client'),
    isActive: z.boolean().default(true),
    addresses: z.array(orgAddressSchema).max(50).default([]),
    version: versionField,
  })
  .superRefine((c, ctx) => {
    if (!c.addresses.some((a) => a.usageType === 'Shipping' && a.isActive)) {
      ctx.addIssue({
        code: 'custom',
        path: ['addresses'],
        message: 'Add at least one active Shipping address',
      });
    }
  });
export type CustomerInput = z.input<typeof customerSchema>;
export type CustomerSave = z.output<typeof customerSchema>;

export const CUSTOMER_DEFAULTS: CustomerInput = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  clientId: '',
  isActive: true,
  addresses: [],
};

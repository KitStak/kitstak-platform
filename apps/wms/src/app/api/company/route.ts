/**
 * `GET /api/company` — company information, defaults and security policy.
 * `PATCH /api/company?section=info|defaults|security` — updates one section (optimistic `version`).
 */
import { z } from 'zod';
import { defineRoute } from '@/server/api/define-route';
import { AppError, fromZodError } from '@/server/api/errors';
import {
  companyDefaultsSchema,
  companyInfoSchema,
  companySecuritySchema,
} from '@/lib/grid-defs/admin/company';
import {
  getCompany,
  updateCompanyDefaults,
  updateCompanyInfo,
  updateCompanySecurity,
} from '@/server/repositories/company';

export const GET = defineRoute({
  permission: ['settings.company_settings.view', 'settings.users.view'],
  handler: async ({ db }) => await getCompany(db),
});

const sectionQuery = z.object({ section: z.enum(['info', 'defaults', 'security']) });

export const PATCH = defineRoute({
  permission: 'settings.company_settings.update',
  query: sectionQuery,
  body: z.record(z.string(), z.unknown()),
  handler: async ({ db, auth, actor, query, body, audit }) => {
    const parse = <S extends z.ZodType>(schema: S): z.output<S> => {
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw fromZodError(parsed.error);
      return parsed.data;
    };
    switch (query.section) {
      case 'info': {
        const result = await updateCompanyInfo(db, auth, actor, parse(companyInfoSchema));
        await audit({
          action: 'company.update',
          entity: 'company',
          entityId: 'company',
          detail: { section: 'information' },
        });
        return result;
      }
      case 'defaults': {
        const result = await updateCompanyDefaults(db, auth, actor, parse(companyDefaultsSchema));
        await audit({
          action: 'company.update',
          entity: 'company',
          entityId: 'company',
          detail: { section: 'account defaults' },
        });
        return result;
      }
      case 'security': {
        const input = parse(companySecuritySchema);
        const result = await updateCompanySecurity(db, auth, actor, input);
        await audit({
          action: 'company.security',
          entity: 'company',
          entityId: 'company',
          detail: { minLength: input.minLength, lockoutThreshold: input.lockoutThreshold },
        });
        return result;
      }
      default:
        throw new AppError('VALIDATION', 'Unknown section');
    }
  },
});

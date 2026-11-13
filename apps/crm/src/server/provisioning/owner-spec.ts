/**
 * Input handling for `scripts/provision-org-owner.ts`: turns command-line flags into a
 * validated description of the organization and owner to create. Pure, so it is tested
 * without a database.
 */
import { DEFAULT_PASSWORD_POLICY, validatePassword } from '@kitstak/auth/password-policy';
import { MODULES, isModule, type Module } from '@kitstak/entitlements';

export interface OwnerSpec {
  /** Lowercased: Better Auth looks sign-in emails up in lower case. */
  readonly email: string;
  readonly name: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly modules: readonly Module[];
  readonly skipOnboarding: boolean;
  readonly requirePasswordChange: boolean;
  readonly dryRun: boolean;
  /** Skip the type-the-slug confirmation (automation only). */
  readonly assumeYes: boolean;
}

export type SpecResult =
  | { readonly ok: true; readonly spec: OwnerSpec }
  | { readonly ok: false; readonly errors: readonly string[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const MAX_NAME = 120;

export const USAGE = `Usage:
  provision-org-owner --email <address> --name <full name> --org <organization name>
                      --slug <org-slug> --modules <${MODULES.join(',')}>
                      [--keep-onboarding] [--no-password-change] [--dry-run] [--yes]

The password is never passed as a flag: it is asked for without echo, or read from the
PROVISION_PASSWORD environment variable when there is no terminal.`;

/** Reads `--flag value` and bare `--flag` pairs. Unknown flags are reported, not ignored. */
function readFlags(argv: readonly string[]): { values: Map<string, string>; switches: Set<string>; errors: string[] } {
  const valueFlags = new Set(['email', 'name', 'org', 'slug', 'modules']);
  const switchFlags = new Set(['keep-onboarding', 'no-password-change', 'dry-run', 'yes']);
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const errors: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const flag = arg.startsWith('--') ? arg.slice(2) : null;
    if (flag !== null && switchFlags.has(flag)) {
      switches.add(flag);
    } else if (flag !== null && valueFlags.has(flag)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) errors.push(`--${flag} needs a value.`);
      else {
        values.set(flag, value);
        i += 1;
      }
    } else {
      errors.push(`Unknown argument '${arg}'.`);
    }
  }
  return { values, switches, errors };
}

export function parseOwnerSpec(argv: readonly string[]): SpecResult {
  const { values, switches, errors } = readFlags(argv);
  const email = (values.get('email') ?? '').trim().toLowerCase();
  const name = (values.get('name') ?? '').trim();
  const orgName = (values.get('org') ?? '').trim();
  const orgSlug = (values.get('slug') ?? '').trim();
  const moduleNames = (values.get('modules') ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const problems = [
    ...errors,
    ...(EMAIL.test(email) ? [] : ['--email must be a valid email address.']),
    ...(name.length > 0 && name.length <= MAX_NAME ? [] : ['--name is required (up to 120 characters).']),
    ...(orgName.length > 0 && orgName.length <= MAX_NAME ? [] : ['--org is required (up to 120 characters).']),
    ...(SLUG.test(orgSlug) ? [] : ['--slug must be lowercase letters, digits and hyphens (e.g. midland).']),
    ...(moduleNames.length > 0 ? [] : [`--modules needs at least one of: ${MODULES.join(', ')}.`]),
    ...moduleNames.filter((entry) => !isModule(entry)).map((entry) => `Unknown module '${entry}'.`),
    // The WMS has no forced-password-change guard, so a provisioned password could stay in use there.
    ...(moduleNames.includes('wms') && !switches.has('no-password-change')
      ? ['--modules wms cannot be combined with a required password change: the WMS does not enforce it yet.']
      : []),
  ];
  if (problems.length > 0) return { ok: false, errors: problems };

  return {
    ok: true,
    spec: {
      email,
      name,
      orgName,
      orgSlug,
      modules: [...new Set(moduleNames.filter(isModule))],
      skipOnboarding: !switches.has('keep-onboarding'),
      requirePasswordChange: !switches.has('no-password-change'),
      dryRun: switches.has('dry-run'),
      assumeYes: switches.has('yes'),
    },
  };
}

/** The same policy sign-up enforces, so a provisioned password is never weaker than a chosen one. */
export function passwordProblems(password: string, spec: Pick<OwnerSpec, 'email' | 'name'>): readonly string[] {
  return validatePassword(password, DEFAULT_PASSWORD_POLICY, { email: spec.email, name: spec.name });
}

/**
 * Org-level rows that keep every guided-setup surface closed: both setup guides dismissed,
 * and a completed profile so a direct visit to the portal's /welcome passes straight through
 * (docs/integration/ONBOARDING.md).
 */
export function onboardingRows(
  spec: Pick<OwnerSpec, 'modules'>,
): readonly { scope: 'portal' | 'crm' | 'wms'; stepKey: string; status: 'completed' | 'dismissed'; payload: Record<string, unknown> }[] {
  const hasCrm = spec.modules.includes('crm');
  const hasWms = spec.modules.includes('wms');
  return [
    {
      scope: 'portal',
      stepKey: 'profile',
      status: 'completed',
      payload: {
        focus: hasCrm && hasWms ? 'both' : hasWms ? 'wms' : 'crm',
        businessType: 'other',
        teamSize: 'solo',
        startMode: 'fresh',
      },
    },
    { scope: 'portal', stepKey: 'guide', status: 'dismissed', payload: {} },
    ...(hasCrm ? [{ scope: 'crm' as const, stepKey: 'guide', status: 'dismissed' as const, payload: {} }] : []),
    ...(hasWms ? [{ scope: 'wms' as const, stepKey: 'guide', status: 'dismissed' as const, payload: {} }] : []),
  ];
}

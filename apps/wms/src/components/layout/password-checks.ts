/** Client-side mirror of the company password policy, for live checklist hints. */

export interface PasswordPolicyHints {
  readonly minLength: number;
  readonly requireUpper: boolean;
  readonly requireNumber: boolean;
  readonly requireSymbol: boolean;
}

export interface PasswordCheck {
  readonly key: string;
  readonly label: string;
  readonly ok: boolean;
}

export function passwordChecks(password: string, policy: PasswordPolicyHints): readonly PasswordCheck[] {
  const checks: PasswordCheck[] = [
    {
      key: 'length',
      label: `At least ${policy.minLength} characters`,
      ok: password.length >= policy.minLength,
    },
  ];
  if (policy.requireUpper) {
    checks.push({ key: 'upper', label: 'An uppercase letter', ok: /[A-Z]/.test(password) });
    checks.push({ key: 'lower', label: 'A lowercase letter', ok: /[a-z]/.test(password) });
  }
  if (policy.requireNumber) checks.push({ key: 'number', label: 'A number', ok: /[0-9]/.test(password) });
  if (policy.requireSymbol)
    checks.push({ key: 'symbol', label: 'A symbol', ok: /[^A-Za-z0-9]/.test(password) });
  return checks;
}

export function passwordMeetsPolicy(password: string, policy: PasswordPolicyHints): boolean {
  return passwordChecks(password, policy).every((check) => check.ok);
}

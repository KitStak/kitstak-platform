/** "By creating an account you agree to the Terms and the Privacy Policy." with real links. */
export interface LegalUrls {
  readonly terms: string;
  readonly privacy: string;
}

const LINK = 'font-medium text-fg-secondary underline underline-offset-2 hover:text-fg';

export function LegalLine({ urls, lead }: { readonly urls: LegalUrls; readonly lead: string }) {
  return (
    <p className="text-center text-xs leading-5 text-fg-muted">
      {lead} you agree to the{' '}
      <a href={urls.terms} target="_blank" rel="noopener" className={LINK}>
        Terms
      </a>{' '}
      and the{' '}
      <a href={urls.privacy} target="_blank" rel="noopener" className={LINK}>
        Privacy Policy
      </a>
      .
    </p>
  );
}

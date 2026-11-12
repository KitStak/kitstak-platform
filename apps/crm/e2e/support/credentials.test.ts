import { describe, expect, it } from 'vitest';
import { parseSeedReadme } from './credentials';
import { parseAction } from './actions';

describe('parseSeedReadme', () => {
  it('reads key/value lines with inline code', () => {
    const md = '## Demo login\n\n- Email: `admin@kitstak.dev`\n- Password: `Demo-Pass-123!`\n';
    expect(parseSeedReadme(md)).toEqual({ email: 'admin@kitstak.dev', password: 'Demo-Pass-123!' });
  });

  it('prefers the admin row of a markdown table', () => {
    const md = [
      '| Role | Email | Password |',
      '| --- | --- | --- |',
      '| Member | `sam@kitstak.dev` | `member-pass-1` |',
      '| Admin | `alex@kitstak.dev` | `admin-pass-1` |',
    ].join('\n');
    expect(parseSeedReadme(md)).toEqual({ email: 'alex@kitstak.dev', password: 'admin-pass-1' });
  });

  it('prefers the email after an admin mention in prose', () => {
    const md =
      'Viewer: viewer@kitstak.dev / password: `v-pass-1`\n\n### Admin\nemail: owner@kitstak.dev\npassword = o-pass-1\n';
    expect(parseSeedReadme(md)).toEqual({ email: 'owner@kitstak.dev', password: 'o-pass-1' });
  });

  it('returns null when nothing is documented', () => {
    expect(parseSeedReadme('# Seed data\n\nCredentials are documented here by the seed owner.')).toBeNull();
  });
});

describe('parseAction', () => {
  it('splits verb and argument on the first colon only', () => {
    expect(parseAction('click:role=button[name="New: item"]')).toMatchObject({
      verb: 'click',
      arg: 'role=button[name="New: item"]',
    });
  });

  it('rejects unknown verbs and missing arguments', () => {
    expect(() => parseAction('tap:.x')).toThrow(/Unknown action/);
    expect(() => parseAction('click:')).toThrow(/needs an argument/);
  });

  it('allows bare shot', () => {
    expect(parseAction('shot')).toMatchObject({ verb: 'shot', arg: '' });
  });
});

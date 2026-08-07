import { describe, expect, it } from 'vitest';
import {
  EXPECTED_PRODUCTION_SUPABASE_PROJECT_REF,
  assertSupabaseDbUrlProjectIdentity,
  evaluateSupabaseDbUrlProjectIdentity,
  expectedDirectDbHostname,
  expectedPoolerUsername,
} from '../supabase-db-url-project-identity';

const PROJECT_REF = EXPECTED_PRODUCTION_SUPABASE_PROJECT_REF;
const DIRECT_HOST = expectedDirectDbHostname(PROJECT_REF);
const POOLER_USER = expectedPoolerUsername(PROJECT_REF);

describe('supabase DB URL project identity', () => {
  it('fails closed when the secret is missing', () => {
    for (const rawUrl of [null, undefined, '', '   ']) {
      const result = evaluateSupabaseDbUrlProjectIdentity({
        rawUrl,
        expectedProjectRef: PROJECT_REF,
      });
      expect(result).toMatchObject({
        secretPresent: false,
        accepted: false,
        failureCode: 'missing_secret',
      });
      expect(() =>
        assertSupabaseDbUrlProjectIdentity({
          rawUrl,
          expectedProjectRef: PROJECT_REF,
        }),
      ).toThrow(/SUPABASE_DB_URL secret is missing/);
    }
  });

  it('rejects a wrong Supabase project ref before any SQL would run', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: 'postgresql://postgres.otherproject:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
      expectedProjectRef: PROJECT_REF,
    });
    expect(result.accepted).toBe(false);
    expect(result.failureCode).toBe('project_ref_mismatch');
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(JSON.stringify(result)).not.toContain('postgresql://');
    expect(() =>
      assertSupabaseDbUrlProjectIdentity({
        rawUrl: 'postgresql://postgres.wrongref:hunter2@db.wrongref.supabase.co:5432/postgres',
        expectedProjectRef: PROJECT_REF,
      }),
    ).toThrow(/project identity mismatch/);
  });

  it('accepts session-pooler username postgres.<project-ref> on *.pooler.supabase.com', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: `postgresql://${POOLER_USER}:does-not-matter@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      expectedProjectRef: PROJECT_REF,
    });
    expect(result).toMatchObject({
      secretPresent: true,
      schemeIsPostgres: true,
      hostnameHasExpectedRef: false,
      usernameHasExpectedRef: true,
      accepted: true,
      failureCode: null,
    });
  });

  it('accepts direct host db.<project-ref>.supabase.co exactly', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: `postgresql://postgres:does-not-matter@${DIRECT_HOST}:5432/postgres`,
      expectedProjectRef: PROJECT_REF,
    });
    expect(result).toMatchObject({
      secretPresent: true,
      schemeIsPostgres: true,
      hostnameHasExpectedRef: true,
      usernameHasExpectedRef: false,
      accepted: true,
      failureCode: null,
    });
  });

  it('never returns password or raw userinfo in the evaluation result', () => {
    const password = 'super-secret-password-value';
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: `postgresql://${POOLER_USER}:${password}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      expectedProjectRef: PROJECT_REF,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain('postgres.');
    expect(serialized).not.toContain('pooler.supabase.com');
    expect(serialized).not.toContain('postgresql://');
    expect(result.accepted).toBe(true);
  });

  it('rejects non-postgres schemes', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: `https://${PROJECT_REF}.supabase.co`,
      expectedProjectRef: PROJECT_REF,
    });
    expect(result.accepted).toBe(false);
    expect(result.failureCode).toBe('invalid_scheme');
  });

  it('rejects expected username on a non-pooler / non-direct host (evil domain)', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: `postgresql://${POOLER_USER}:secret@evil.example.com:5432/postgres`,
      expectedProjectRef: PROJECT_REF,
    });
    expect(result).toMatchObject({
      accepted: false,
      failureCode: 'project_ref_mismatch',
      usernameHasExpectedRef: true,
      hostnameHasExpectedRef: false,
    });
  });

  it('rejects direct-host suffix / parent-domain attacks', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: `postgresql://postgres:secret@${DIRECT_HOST}.evil.example.com:5432/postgres`,
      expectedProjectRef: PROJECT_REF,
    });
    expect(result).toMatchObject({
      accepted: false,
      failureCode: 'project_ref_mismatch',
      hostnameHasExpectedRef: false,
    });
  });

  it('rejects padded pooler usernames that only contain the expected ref as a substring', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: `postgresql://foo-${POOLER_USER}-bar:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      expectedProjectRef: PROJECT_REF,
    });
    expect(result).toMatchObject({
      accepted: false,
      failureCode: 'project_ref_mismatch',
      usernameHasExpectedRef: false,
    });
  });

  it('rejects pooler host with wrong project ref username', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: 'postgresql://postgres.otherref:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
      expectedProjectRef: PROJECT_REF,
    });
    expect(result.accepted).toBe(false);
    expect(result.failureCode).toBe('project_ref_mismatch');
  });

  it('rejects mere hostname substring of the project ref without exact direct host', () => {
    const result = evaluateSupabaseDbUrlProjectIdentity({
      rawUrl: `postgresql://postgres:secret@db.${PROJECT_REF}.supabase.co.evil.example.com:5432/postgres`,
      expectedProjectRef: PROJECT_REF,
    });
    expect(result.accepted).toBe(false);
    expect(result.failureCode).toBe('project_ref_mismatch');
  });
});

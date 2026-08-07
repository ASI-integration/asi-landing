/**
 * Safe project-ref checks for production Postgres URLs.
 * Never returns password, userinfo, or the raw URL.
 */

export const EXPECTED_PRODUCTION_SUPABASE_PROJECT_REF = 'jwinifeienvzejofmbua';

/** Session-pooler hosts must end with this suffix (exact suffix, not a substring elsewhere). */
export const SUPABASE_SESSION_POOLER_HOST_SUFFIX = '.pooler.supabase.com';

export type SupabaseDbUrlProjectIdentityInput = {
  rawUrl: string | null | undefined;
  expectedProjectRef: string;
};

export type SupabaseDbUrlProjectIdentityResult = {
  secretPresent: boolean;
  schemeIsPostgres: boolean;
  hostnameHasExpectedRef: boolean;
  usernameHasExpectedRef: boolean;
  accepted: boolean;
  failureCode:
    | null
    | 'missing_secret'
    | 'invalid_scheme'
    | 'project_ref_mismatch'
    | 'invalid_url';
};

function normalizeSecret(raw: string): string {
  let normalized = raw.trim();
  const hasOuterWrapper =
    normalized.length >= 2 &&
    (normalized.startsWith("'") || normalized.startsWith('"') || normalized.startsWith('`')) &&
    normalized[0] === normalized[normalized.length - 1];
  if (hasOuterWrapper) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/^\uFEFF/, '');
}

function decodeUserinfoPart(value: string | null): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function expectedDirectDbHostname(projectRef: string): string {
  return `db.${projectRef.trim().toLowerCase()}.supabase.co`;
}

export function expectedPoolerUsername(projectRef: string): string {
  return `postgres.${projectRef.trim().toLowerCase()}`;
}

/**
 * Evaluate whether a Postgres URL belongs to the expected Supabase project.
 *
 * ACCEPT ONLY:
 * 1) Direct DB hostname exactly: db.<ref>.supabase.co
 * 2) Session pooler: hostname ends with .pooler.supabase.com AND decoded
 *    username equals exactly postgres.<ref>
 *
 * Rejects mere substring matches (evil parent domains, padded usernames, etc.).
 * Never inspects or returns password material beyond boolean presence of a secret string.
 */
export function evaluateSupabaseDbUrlProjectIdentity(
  input: SupabaseDbUrlProjectIdentityInput,
): SupabaseDbUrlProjectIdentityResult {
  const expected = (input.expectedProjectRef || '').trim();
  const raw = input.rawUrl ?? '';

  if (!raw || !raw.trim()) {
    return {
      secretPresent: false,
      schemeIsPostgres: false,
      hostnameHasExpectedRef: false,
      usernameHasExpectedRef: false,
      accepted: false,
      failureCode: 'missing_secret',
    };
  }

  if (!expected) {
    return {
      secretPresent: true,
      schemeIsPostgres: false,
      hostnameHasExpectedRef: false,
      usernameHasExpectedRef: false,
      accepted: false,
      failureCode: 'project_ref_mismatch',
    };
  }

  let normalized: string;
  try {
    normalized = normalizeSecret(raw);
  } catch {
    return {
      secretPresent: true,
      schemeIsPostgres: false,
      hostnameHasExpectedRef: false,
      usernameHasExpectedRef: false,
      accepted: false,
      failureCode: 'invalid_url',
    };
  }

  if (!normalized || /\r|\n/.test(normalized)) {
    return {
      secretPresent: true,
      schemeIsPostgres: false,
      hostnameHasExpectedRef: false,
      usernameHasExpectedRef: false,
      accepted: false,
      failureCode: 'invalid_url',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      secretPresent: true,
      schemeIsPostgres: false,
      hostnameHasExpectedRef: false,
      usernameHasExpectedRef: false,
      accepted: false,
      failureCode: 'invalid_url',
    };
  }

  const schemeIsPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  const hostname = (parsed.hostname || '').toLowerCase();
  const username = decodeUserinfoPart(parsed.username).toLowerCase();
  const directHost = expectedDirectDbHostname(expected);
  const poolerUser = expectedPoolerUsername(expected);
  const hostnameHasExpectedRef = hostname === directHost;
  const usernameHasExpectedRef = username === poolerUser;
  const poolerHostOk = hostname.endsWith(SUPABASE_SESSION_POOLER_HOST_SUFFIX);
  const identityOk = hostnameHasExpectedRef || (poolerHostOk && usernameHasExpectedRef);

  if (!schemeIsPostgres) {
    return {
      secretPresent: true,
      schemeIsPostgres: false,
      hostnameHasExpectedRef,
      usernameHasExpectedRef,
      accepted: false,
      failureCode: 'invalid_scheme',
    };
  }

  if (!identityOk) {
    return {
      secretPresent: true,
      schemeIsPostgres: true,
      hostnameHasExpectedRef,
      usernameHasExpectedRef,
      accepted: false,
      failureCode: 'project_ref_mismatch',
    };
  }

  return {
    secretPresent: true,
    schemeIsPostgres: true,
    hostnameHasExpectedRef,
    usernameHasExpectedRef,
    accepted: true,
    failureCode: null,
  };
}

export function assertSupabaseDbUrlProjectIdentity(
  input: SupabaseDbUrlProjectIdentityInput,
): SupabaseDbUrlProjectIdentityResult {
  const result = evaluateSupabaseDbUrlProjectIdentity(input);
  if (!result.accepted) {
    const message =
      result.failureCode === 'missing_secret'
        ? 'SUPABASE_DB_URL secret is missing.'
        : result.failureCode === 'invalid_scheme'
          ? 'SUPABASE_DB_URL must be a postgres/postgresql URL.'
          : result.failureCode === 'project_ref_mismatch'
            ? 'SUPABASE_DB_URL project identity mismatch.'
            : 'SUPABASE_DB_URL is invalid.';
    throw new Error(message);
  }
  return result;
}

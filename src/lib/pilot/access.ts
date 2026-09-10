/**
 * Strigunov Pilot SP-02 — invite allowlist + role helpers.
 * Role is derived from env allowlists at request time (no session mutation).
 * Owner Development Console allowlist (`ASI_DEVELOPMENT_OWNER_EMAILS`) is
 * intentionally separate and unchanged.
 */

export const PILOT_BETA_ROLE = 'pilot_beta' as const;
export const DEVELOPMENT_OWNER_ROLE = 'development_owner' as const;

export type PilotAppRole = typeof PILOT_BETA_ROLE | typeof DEVELOPMENT_OWNER_ROLE;

function parseEmailList(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((email) => email.includes('@'));
}

/** Pilot beta invite allowlist. Values must never be logged or sent to the browser. */
export function pilotBetaAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const emails = new Set<string>();
  for (const email of parseEmailList(env.ASI_PILOT_BETA_EMAILS)) {
    emails.add(email);
  }
  return emails;
}

/**
 * Invite check for external beta users.
 * - Deny-by-default when ASI_PILOT_BETA_EMAILS is empty.
 * - Case-insensitive email match.
 * - Owner/CRM membership alone never grants pilot_beta.
 */
export function isPilotBetaEmail(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  const allowlist = pilotBetaAllowlist(env);
  if (allowlist.size === 0) return false;
  return allowlist.has(normalized);
}

/**
 * Resolve whether the email holds the pilot_beta invite.
 * Does not grant development_owner; dual membership is possible but each
 * surface still checks its own allowlist independently.
 */
export function resolvePilotBetaRole(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): typeof PILOT_BETA_ROLE | null {
  return isPilotBetaEmail(email, env) ? PILOT_BETA_ROLE : null;
}

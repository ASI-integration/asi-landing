import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import {
  OtaFinanceAccessError,
  requireOtaFinanceScope,
  type OtaFinanceScopeRequest,
} from './access';

export type OtaFinancePrincipal = Awaited<ReturnType<typeof requireOtaFinanceScope>>;

export interface DenialAuditSqlWriter {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export class FinanceDenialAuditUnavailable extends Error {
  constructor() {
    super('FINANCE_DENIAL_AUDIT_UNAVAILABLE');
    this.name = 'FinanceDenialAuditUnavailable';
  }
}

const DENIAL = `insert into ota_finance_private.access_denials
  (request_id, action, reason_code, scope_sha256, outcome)
  values ($1::uuid, $2, $3, $4, 'DENIED')
  returning id`;

function safeAction(request: OtaFinanceScopeRequest): string {
  const action = request?.action;
  return action === 'read' || action === 'import' || action === 'review' || action === 'fee_rule'
    ? action : 'invalid_action';
}

/**
 * Fail-closed audited authorization boundary for FUTURE server endpoints.
 * No pool, credentials, HTTP route or live DB side effect is created here.
 *
 * Record a denial even if no valid actor/tenant exists. Never persist IP,
 * guest details, raw requested account/property/booking, or session values.
 * Only the one-time SHA-256 fingerprint of this request is stored.
 */
export async function requireAuditedOtaFinanceScope(
  audit: DenialAuditSqlWriter,
  request: OtaFinanceScopeRequest,
): Promise<OtaFinancePrincipal> {
  try {
    return await requireOtaFinanceScope(request);
  } catch (error) {
    if (!(error instanceof OtaFinanceAccessError)) throw error;

    const requestId = randomUUID();
    const scopeSha256 = createHash('sha256')
      .update(requestId + '\u0000' + JSON.stringify({
        account: request?.accountId ?? null,
        property: request?.propertyId ?? null,
        booking: request?.bookingId ?? null,
      }))
      .digest('hex');
    // A denial MUST NOT become authorized when the audit store fails.
    try {
      if (!audit || typeof audit.query !== 'function') throw new Error('NO_DENIAL_AUDIT_SINK');
      const result = await audit.query<{ id: string }>(
        DENIAL, [requestId, safeAction(request), error.code, scopeSha256],
      );
      if (!Array.isArray(result.rows) || result.rows.length !== 1
          || typeof result.rows[0]?.id !== 'string') {
        throw new Error('DENIAL_AUDIT_INSERT_NOT_CONFIRMED');
      }
    } catch {
      // Avoid leaking SQL details and failed raw auth payload to clients.
      throw new FinanceDenialAuditUnavailable();
    }
    throw error;
  }
}

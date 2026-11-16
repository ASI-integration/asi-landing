import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Backend-only authorization gate for proposed private OTA finance storage.
 * The caller MUST inject a trusted service-role client kept out of the browser.
 * This does not create a financial write API or authorize bank/OTA operations.
 */
export type OtaFinanceIntent = 'read' | 'append';
export type FinanceScopeRequest = Readonly<{
  accessToken: string;
  accountId: string;
  propertyId: string;
  intent: OtaFinanceIntent;
}>;
export type AuthorizedFinanceScope = Readonly<{
  userId: string;
  accountId: string;
  propertyId: string;
  intent: OtaFinanceIntent;
  role: 'owner' | 'admin' | 'manager';
}>;
export class FinanceScopeDenied extends Error {
  constructor() {
    super('FINANCE_SCOPE_DENIED');
    this.name = 'FinanceScopeDenied';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Always validates the submitted token against Supabase Auth rather than
 * reading unverified decoded JWT, request body userId, or user_metadata.
 * The accounts and properties tables are only queried by a trusted backend.
 */
export async function authorizeOtaFinanceScope(
  request: FinanceScopeRequest,
  serverClient: SupabaseClient,
): Promise<AuthorizedFinanceScope> {
  if (!request || typeof request.accessToken !== 'string'
    || request.accessToken.length < 12 || request.accessToken.length > 8192
    || !UUID.test(request.accountId) || !UUID.test(request.propertyId)
    || !['read', 'append'].includes(request.intent)) {
    throw new FinanceScopeDenied();
  }
  // Do not expose whether the user, account, property or membership exists.
  try {
    const verified = await serverClient.auth.getUser(request.accessToken);
    const userId = verified.data?.user?.id;
    if (verified.error || typeof userId !== 'string' || !UUID.test(userId)) {
      throw new FinanceScopeDenied();
    }

    const membershipResult = await serverClient.from('account_members')
      .select('role')
      .eq('account_id', request.accountId)
      .eq('user_id', userId)
      .maybeSingle();
    const role = membershipResult.data?.role;
    if (membershipResult.error || !['owner', 'admin', 'manager'].includes(role)) {
      throw new FinanceScopeDenied();
    }
    if (request.intent === 'append' && role === 'manager') {
      throw new FinanceScopeDenied();
    }
    const propertyResult = await serverClient.from('properties')
      .select('id,account_id')
      .eq('id', request.propertyId)
      .eq('account_id', request.accountId)
      .maybeSingle();
    const property = propertyResult.data;
    if (propertyResult.error || !property
      || property.id !== request.propertyId
      || property.account_id !== request.accountId) {
      throw new FinanceScopeDenied();
    }
    return Object.freeze({
      userId, accountId: request.accountId, propertyId: request.propertyId,
      intent: request.intent, role: role as AuthorizedFinanceScope['role'],
    });
  } catch {
    throw new FinanceScopeDenied();
  }
}

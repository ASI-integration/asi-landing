import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const AUTHENTICATED_PARTNER_PRINCIPAL = Symbol('authenticated-partner-principal');
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_BEARER_TOKEN_BYTES = 512;
const DUMMY_TOKEN_HASH = createHash('sha256').update('partner-auth-dummy-value').digest();

export type AuthenticatedPartnerPrincipal = Readonly<{
  [AUTHENTICATED_PARTNER_PRINCIPAL]: true;
  accountId: string;
  partnerId: string;
  externalPartnerAccountId: string;
  credentialId: string;
  partnerAccountBindingId: string;
}>;

type CredentialCandidate = {
  id: string;
  partner_account_binding_id: string;
  credential_id: string;
  token_hash: string;
  status: 'active' | 'revoked';
  expires_at: string | null;
};

type BindingCandidate = {
  id: string;
  account_id: string;
  partner_id: string;
  external_account_id: string;
  status: 'active' | 'disabled';
};

export interface PartnerCredentialDatabase {
  findCredential(credentialId: string): Promise<CredentialCandidate | null>;
  findBinding(bindingId: string): Promise<BindingCandidate | null>;
  markCredentialUsed(credentialRecordId: string, usedAt: string): Promise<void>;
}

export class PartnerAuthenticationError extends Error {
  constructor() {
    super('partner_authentication_failed');
    this.name = 'PartnerAuthenticationError';
  }
}

function fail(): never {
  throw new PartnerAuthenticationError();
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function parseHeaders(headers: Headers): { credentialId: string; token: string } {
  const credentialId = headers.get('x-asi-partner-credential')?.trim() ?? '';
  const authorization = headers.get('authorization') ?? '';
  const bearer = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!CREDENTIAL_ID_PATTERN.test(credentialId) || !bearer) fail();
  const token = bearer[1];
  if (!token || Buffer.byteLength(token, 'utf8') > MAX_BEARER_TOKEN_BYTES) fail();
  return { credentialId, token };
}

function storedHash(value: string | undefined): Buffer {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) return DUMMY_TOKEN_HASH;
  return Buffer.from(value, 'hex');
}

export function isAuthenticatedPartnerPrincipal(value: unknown): value is AuthenticatedPartnerPrincipal {
  return Boolean(value && typeof value === 'object'
    && (value as { [AUTHENTICATED_PARTNER_PRINCIPAL]?: unknown })[AUTHENTICATED_PARTNER_PRINCIPAL] === true);
}

export function hashPartnerBearerTokenForProvisioning(token: string): string {
  return sha256(token).toString('hex');
}

export function createPartnerCredentialAuthenticator(database: PartnerCredentialDatabase) {
  return async function authenticate(headers: Headers): Promise<AuthenticatedPartnerPrincipal> {
    const { credentialId, token } = parseHeaders(headers);
    const candidate = await database.findCredential(credentialId);
    const actual = sha256(token);
    const expected = storedHash(candidate?.token_hash);
    const tokenMatches = actual.length === expected.length && timingSafeEqual(actual, expected);
    const usable = candidate
      && tokenMatches
      && candidate.status === 'active'
      && (!candidate.expires_at || Date.parse(candidate.expires_at) > Date.now());
    if (!usable) fail();

    const binding = await database.findBinding(candidate.partner_account_binding_id);
    if (!binding || binding.status !== 'active' || binding.id !== candidate.partner_account_binding_id) fail();

    await database.markCredentialUsed(candidate.id, new Date().toISOString()).catch(() => undefined);
    return Object.freeze({
      [AUTHENTICATED_PARTNER_PRINCIPAL]: true as const,
      accountId: binding.account_id,
      partnerId: binding.partner_id,
      externalPartnerAccountId: binding.external_account_id,
      credentialId: candidate.credential_id,
      partnerAccountBindingId: binding.id,
    });
  };
}

function persistenceFailure(): never {
  fail();
}

export function createSupabasePartnerCredentialDatabase(client: SupabaseClient): PartnerCredentialDatabase {
  return {
    async findCredential(credentialId) {
      const { data, error } = await client.from('partner_api_credentials').select('*')
        .eq('credential_id', credentialId).maybeSingle();
      if (error) persistenceFailure();
      return data as CredentialCandidate | null;
    },
    async findBinding(bindingId) {
      const { data, error } = await client.from('partner_account_bindings').select('*')
        .eq('id', bindingId).maybeSingle();
      if (error) persistenceFailure();
      return data as BindingCandidate | null;
    },
    async markCredentialUsed(credentialRecordId, usedAt) {
      const { error } = await client.from('partner_api_credentials')
        .update({ last_used_at: usedAt }).eq('id', credentialRecordId);
      if (error) throw new Error('credential_usage_update_failed');
    },
  };
}

export const authenticatePartnerRequest = createPartnerCredentialAuthenticator(
  createSupabasePartnerCredentialDatabase(supabase),
);

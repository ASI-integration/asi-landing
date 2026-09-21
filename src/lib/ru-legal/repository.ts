import 'server-only';
import { supabase } from '@/lib/supabase';
import {
  RU_LEGAL_DOCUMENTS,
  type RuLegalDocumentType,
  ruLegalDocumentSha256,
} from './documents';

export const RU_LEGAL_LOCALIZATION_GATE_CODE = 'RU_LEGAL_LOCALIZATION_REVIEW_REQUIRED' as const;
export const LEGAL_ACCEPTANCE_REQUIRED_CODE = 'LEGAL_ACCEPTANCE_REQUIRED' as const;

export type RuLegalAcceptanceSummary = {
  documentType: RuLegalDocumentType;
  documentVersion: string;
  acceptedAt: string;
};

export type RuLegalOnboardingState = {
  accountId: string;
  role: string;
  isOwner: boolean;
  accepted: Partial<Record<RuLegalDocumentType, RuLegalAcceptanceSummary>>;
  complete: boolean;
};

export function isRuLegalAcceptancePersistenceEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.RU_LEGAL_ACCEPTANCE_PERSISTENCE_ENABLED === 'true';
}

async function membershipForUser(userId: string): Promise<{ account_id: string; role: string } | null> {
  const { data, error } = await supabase
    .from('account_members')
    .select('account_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[ru-legal] account membership lookup failed: ${error.message}`);
  return data as { account_id: string; role: string } | null;
}

export async function getRuLegalOnboardingStateForAccount(
  accountId: string,
  role = 'unknown',
): Promise<RuLegalOnboardingState> {
  const { data, error } = await supabase
    .from('ru_legal_acceptances')
    .select('document_type, document_version, document_sha256, accepted_at')
    .eq('account_id', accountId)
    .in('document_type', ['offer', 'personal_data_consent']);
  if (error) throw new Error(`[ru-legal] acceptance lookup failed: ${error.message}`);

  const accepted: RuLegalOnboardingState['accepted'] = {};
  for (const row of data ?? []) {
    const type = row.document_type as RuLegalDocumentType;
    const current = RU_LEGAL_DOCUMENTS[type];
    if (current && row.document_version === current.version && row.document_sha256 === ruLegalDocumentSha256(current)) {
      accepted[type] = {
        documentType: type,
        documentVersion: row.document_version,
        acceptedAt: row.accepted_at,
      };
    }
  }
  return {
    accountId,
    role,
    isOwner: role === 'owner',
    accepted,
    complete: Boolean(accepted.offer && accepted.personal_data_consent),
  };
}

export async function getRuLegalOnboardingStateForUser(userId: string): Promise<RuLegalOnboardingState | null> {
  const membership = await membershipForUser(userId);
  if (!membership) return null;
  return getRuLegalOnboardingStateForAccount(membership.account_id, membership.role);
}

export async function acceptCurrentRuLegalDocument(input: {
  userId: string;
  email: string;
  documentType: RuLegalDocumentType;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<RuLegalAcceptanceSummary> {
  if (!isRuLegalAcceptancePersistenceEnabled()) {
    throw new Error(RU_LEGAL_LOCALIZATION_GATE_CODE);
  }
  const membership = await membershipForUser(input.userId);
  if (!membership) throw new Error('RU_ACCOUNT_MEMBERSHIP_REQUIRED');
  if (membership.role !== 'owner') throw new Error('RU_LEGAL_OWNER_REQUIRED');

  const document = RU_LEGAL_DOCUMENTS[input.documentType];
  const existing = await getRuLegalOnboardingStateForAccount(membership.account_id, membership.role);
  if (input.documentType === 'personal_data_consent' && !existing.accepted.offer) {
    throw new Error('RU_LEGAL_OFFER_REQUIRED');
  }
  const current = existing.accepted[input.documentType];
  if (current) return current;

  const { data, error } = await supabase
    .from('ru_legal_acceptances')
    .insert({
      account_id: membership.account_id,
      accepted_by_user_id: input.userId,
      document_type: document.type,
      document_version: document.version,
      document_sha256: ruLegalDocumentSha256(document),
      email_snapshot: input.email.trim().toLowerCase().slice(0, 320),
      ip_address: input.ipAddress?.slice(0, 128) || null,
      user_agent: input.userAgent?.slice(0, 1024) || null,
    })
    .select('document_type, document_version, accepted_at')
    .single();
  if (error) throw new Error(`[ru-legal] acceptance insert failed: ${error.message}`);
  return {
    documentType: data.document_type as RuLegalDocumentType,
    documentVersion: data.document_version,
    acceptedAt: data.accepted_at,
  };
}

export async function hasCurrentRuLegalAcceptance(accountId: string): Promise<boolean> {
  return (await getRuLegalOnboardingStateForAccount(accountId)).complete;
}

export async function getActiveRuAccountSpecialOffer(accountId: string, now = new Date()) {
  const iso = now.toISOString();
  const { data, error } = await supabase
    .from('ru_account_special_offers')
    .select('offer_code, monthly_price_rub, starts_at, ends_at')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[ru-legal] special offer lookup failed: ${error.message}`);
  if (!data) return null;
  if (data.starts_at && data.starts_at > iso) return null;
  if (data.ends_at && data.ends_at <= iso) return null;
  return data as {
    offer_code: string;
    monthly_price_rub: number;
    starts_at: string | null;
    ends_at: string | null;
  };
}

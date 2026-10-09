import 'server-only';
import { createHash, createHmac } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import type { PublicPilotLeadResult } from './public-pilot-lead';
import { publicLeadConsentPolicy } from './public-lead-consent';

type EligibleLead = Extract<PublicPilotLeadResult, { ok: true }>;
type ProcessResult =
  | { allowed: false; retryAfterSeconds: number }
  | { allowed: true; replayed: boolean };

function unavailable(): never {
  // Never attach raw RPC errors, contact identifiers or fingerprints.
  throw new Error('Public lead admission unavailable');
}

export async function processPublicPilotLead(lead: EligibleLead): Promise<ProcessResult> {
  if (lead.ok !== true || lead.consent !== true ||
      !['site', 'strigunov'].includes(lead.referral)) unavailable();
  // Provision one independently generated 32-byte secret across ALL workers.
  // Never generate a per-process fallback or silently change digest namespaces.
  const configured = process.env.PUBLIC_LEAD_HMAC_KEY;
  if (!configured || !/^[0-9a-fA-F]{64}$/.test(configured)) unavailable();
  const key = Buffer.from(configured, 'hex');
  const hmac = (domain: string, value: string) =>
    createHmac('sha256', key).update(JSON.stringify(['public-lead-v1', domain, value])).digest('hex');
  const input = lead.input;
  const kind = input.telegramUsername ? 'telegram' : input.email ? 'email' : 'phone';
  const contact = kind === 'telegram' ? input.telegramUsername.toLowerCase()
    : kind === 'email' ? input.email!.toLowerCase() : input.phone.replace(/\D/g, '');
  if (!contact) unavailable();
  const policy = publicLeadConsentPolicy();
  // Explicit canonical allowlist: client IDs, hash/version/time fields and IP
  // headers have no authority. Contact formatting/case variants converge.
  const payload = {
    name: input.name,
    contact_kind: kind,
    contact_value: contact,
    objects_count: input.objectsCount,
    note: input.note,
    next_step: input.nextStep,
    referral: lead.referral,
    consent: true,
    policy_id: policy.policyId,
    policy_version: policy.policyVersion,
    policy_source_sha256: policy.sourceSha256,
    policy_content_sha256: policy.contentSha256,
  };
  const submission = hmac('submission', JSON.stringify(payload));
  try {
    // Lazy proxy: no DB construction or I/O at module import. This RPC alone
    // owns admission + CRM insert + consent receipt in one transaction.
    const { data, error } = await supabase.rpc('admit_public_pilot_lead_v1', {
      p_key_commitment: createHash('sha256').update(key).digest('hex'),
      p_contact_digest: hmac('contact', JSON.stringify([kind, contact])),
      p_submission_digest: submission,
      p_payload: payload,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) unavailable();
    const receipt = data as Record<string, unknown>;
    if (receipt.protocol !== 'public-lead-v1') unavailable();
    if (receipt.status === 'rate_limited') {
      const retry = receipt.retry_after_seconds;
      if (typeof retry !== 'number' || !Number.isInteger(retry) || retry < 1 || retry > 3600) unavailable();
      return { allowed: false, retryAfterSeconds: retry };
    }
    if ((receipt.status !== 'created' && receipt.status !== 'replayed') ||
        receipt.persisted !== true || receipt.submission_digest !== submission ||
        typeof receipt.crm_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.crm_id)) {
      unavailable();
    }
    // No automatic retry of an unknown commit result. A subsequent identical
    // request reconciles through the canonical receipt, even after restart.
    return { allowed: true, replayed: receipt.status === 'replayed' };
  } catch {
    unavailable();
  }
}

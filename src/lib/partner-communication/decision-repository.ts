import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { PartnerBrainDecision } from './brain';
import type { PartnerHandoffV1, PartnerOperationalActionV1 } from './contract';

export type PartnerDecisionResultingState = {
  conversation: 'active' | 'awaiting_input' | 'escalated' | 'resolved';
  issue: 'none' | 'open' | 'blocked' | 'resolved';
  operatorRequired: boolean;
};

export type PartnerDecisionEvidence = {
  knowledgeSource: 'tg_property_knowledge' | 'none';
  propertyBindingResolved: boolean;
  bookingBindingResolved: boolean;
  matchedIntent: string;
};

export type DurablePartnerCommunicationDecision = Readonly<{
  id: string;
  accountId: string;
  inboxId: string;
  sessionId: string;
  decision: PartnerBrainDecision;
  evidence: PartnerDecisionEvidence;
  operationalActions: PartnerOperationalActionV1[];
  handoff: PartnerHandoffV1 | null;
  resultingState: PartnerDecisionResultingState;
  createdAt: string;
}>;

type DecisionRow = {
  id: string;
  account_id: string;
  inbox_id: string;
  session_id: string;
  decision_type: PartnerBrainDecision['type'];
  policy: PartnerBrainDecision['policy'];
  response_text: string | null;
  confidence: number | string | null;
  reason_codes: PartnerBrainDecision['reasonCodes'];
  evidence: PartnerDecisionEvidence;
  operational_actions: PartnerOperationalActionV1[];
  handoff: PartnerHandoffV1 | null;
  resulting_state: PartnerDecisionResultingState;
  created_at: string;
  updated_at: string;
};

type InsertResult = { row: DecisionRow | null; conflict: boolean };

export interface PartnerDecisionDatabase {
  findDecision(input: { accountId: string; inboxId: string }): Promise<DecisionRow | null>;
  insertDecision(row: DecisionRow): Promise<InsertResult>;
}

function mapDecision(row: DecisionRow): DurablePartnerCommunicationDecision {
  const confidence = row.confidence === null ? null : Number(row.confidence);
  return Object.freeze({
    id: row.id,
    accountId: row.account_id,
    inboxId: row.inbox_id,
    sessionId: row.session_id,
    decision: Object.freeze({
      type: row.decision_type,
      policy: row.policy,
      text: row.response_text,
      confidence: Number.isFinite(confidence) ? confidence : null,
      reasonCodes: [...row.reason_codes],
    }),
    evidence: Object.freeze({ ...row.evidence }),
    operationalActions: row.operational_actions.map((action) => Object.freeze({ ...action })),
    handoff: row.handoff ? Object.freeze({ ...row.handoff }) : null,
    resultingState: Object.freeze({ ...row.resulting_state }),
    createdAt: row.created_at,
  });
}

export function createPartnerDecisionRepository(database: PartnerDecisionDatabase) {
  return {
    async findPartnerDecision(input: {
      accountId: string;
      inboxId: string;
    }): Promise<DurablePartnerCommunicationDecision | null> {
      const row = await database.findDecision(input);
      return row ? mapDecision(row) : null;
    },

    async createOrReusePartnerDecision(input: {
      accountId: string;
      inboxId: string;
      sessionId: string;
      decision: PartnerBrainDecision;
      evidence: PartnerDecisionEvidence;
      operationalActions: PartnerOperationalActionV1[];
      handoff: PartnerHandoffV1 | null;
      resultingState: PartnerDecisionResultingState;
    }): Promise<DurablePartnerCommunicationDecision> {
      const existing = await database.findDecision(input);
      if (existing) return mapDecision(existing);
      const timestamp = new Date().toISOString();
      const row: DecisionRow = {
        id: randomUUID(),
        account_id: input.accountId,
        inbox_id: input.inboxId,
        session_id: input.sessionId,
        decision_type: input.decision.type,
        policy: input.decision.policy,
        response_text: input.decision.text,
        confidence: input.decision.confidence,
        reason_codes: [...input.decision.reasonCodes],
        evidence: { ...input.evidence },
        operational_actions: input.operationalActions.map((action) => ({ ...action })),
        handoff: input.handoff ? { ...input.handoff } : null,
        resulting_state: { ...input.resultingState },
        created_at: timestamp,
        updated_at: timestamp,
      };
      const inserted = await database.insertDecision(row);
      if (inserted.row) return mapDecision(inserted.row);
      if (!inserted.conflict) throw new Error('partner_decision_persistence_failed');
      const concurrent = await database.findDecision(input);
      if (!concurrent) throw new Error('partner_decision_persistence_failed');
      return mapDecision(concurrent);
    },
  };
}

function uniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function persistenceFailure(): never {
  throw new Error('partner_decision_persistence_failed');
}

export function createSupabasePartnerDecisionDatabase(client: SupabaseClient): PartnerDecisionDatabase {
  return {
    async findDecision(input) {
      const { data, error } = await client.from('partner_communication_decisions').select('*')
        .eq('account_id', input.accountId).eq('inbox_id', input.inboxId).maybeSingle();
      if (error) persistenceFailure();
      return data as DecisionRow | null;
    },
    async insertDecision(row) {
      const { data, error } = await client.from('partner_communication_decisions')
        .insert(row).select('*').maybeSingle();
      if (error && !uniqueViolation(error)) persistenceFailure();
      return { row: data as DecisionRow | null, conflict: uniqueViolation(error) };
    },
  };
}

export const partnerDecisionRepository = createPartnerDecisionRepository(
  createSupabasePartnerDecisionDatabase(supabase),
);

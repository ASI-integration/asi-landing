import 'server-only';

import { isAuthenticatedPartnerPrincipal, type AuthenticatedPartnerPrincipal } from './auth';
import {
  isPartnerCanonicalResolution,
  type PartnerCanonicalResolution,
} from './canonical-context';
import type {
  PartnerCommunicationContext,
  PartnerCommunicationPolicyDecision,
  PartnerCommunicationDecisionType,
} from './contract';
import type { PartnerSession } from './state-repository';
import type { StrictPartnerPropertyKnowledgeResult } from './strict-property-knowledge';

export type PartnerBrainReasonCode =
  | 'grounded_wifi'
  | 'grounded_checkin'
  | 'grounded_checkout'
  | 'grounded_parking'
  | 'grounded_house_rule'
  | 'knowledge_missing'
  | 'knowledge_lookup_failed'
  | 'property_mapping_missing'
  | 'property_mapping_conflict'
  | 'booking_mapping_missing'
  | 'booking_mapping_conflict'
  | 'maintenance_issue'
  | 'urgent_access_issue'
  | 'financial_request_requires_review'
  | 'sensitive_request_requires_review'
  | 'unsupported_property_question';

export type PartnerBrainDecision = Readonly<{
  type: PartnerCommunicationDecisionType;
  text: string | null;
  policy: PartnerCommunicationPolicyDecision;
  confidence: number | null;
  reasonCodes: PartnerBrainReasonCode[];
}>;

export type PartnerBrainResult = Readonly<{
  decision: PartnerBrainDecision;
  matchedIntent: string;
  actionRecommendation: null | Readonly<{
    actionType: 'maintenance_issue';
    priority: 'high';
    reasonCode: 'maintenance_issue';
  }>;
  handoffRecommendation: null | Readonly<{
    priority: 'normal' | 'high' | 'urgent';
    reasonCode: PartnerBrainReasonCode;
  }>;
}>;

type BrainInput = {
  principal: AuthenticatedPartnerPrincipal;
  context: PartnerCommunicationContext;
  canonical: PartnerCanonicalResolution;
  session: PartnerSession;
  knowledge: StrictPartnerPropertyKnowledgeResult;
};

const WIFI = /(?:wi[\s-]?fi|вай[\s-]?фай|ви[\s-]?фи|интернет|парол[ья])/iu;
const CHECKIN = /(?:как\s+(?:попасть|заселиться|заехать)|заселен|вход|инструкц.*заезд)/iu;
const CHECKOUT = /(?:выезд|выехать|оставить\s+ключ|куда\s+ключ|чек[\s-]?аут)/iu;
const PARKING = /(?:парков|машин)/iu;
const HOUSE_RULE = /(?:курить|собак|кошк|питом|животн|вечерин|тишин|правил)/iu;
const MAINTENANCE = /(?:не\s+работает|теч[её]т|протеч|сломал|отоплен|душ|вод[аы]|электрич|свет)/iu;
const URGENT_ACCESS = /(?:не\s+могу\s+попасть|замок\s+не\s+открывается|не\s+открыва(?:ется|ю)|заперт|нет\s+доступа)/iu;
const FINANCIAL = /(?:верните\s+деньги|возврат|компенсац|скидк)/iu;
const SENSITIVE = /(?:оплат|плат[её]ж|карт|банк|юрист|закон|полици|паспорт|безопасност|персональн.*данн)/iu;

function decision(
  type: PartnerCommunicationDecisionType,
  text: string | null,
  policy: PartnerCommunicationPolicyDecision,
  confidence: number | null,
  reasonCode: PartnerBrainReasonCode,
): PartnerBrainDecision {
  return Object.freeze({ type, text, policy, confidence, reasonCodes: [reasonCode] });
}

function joinFacts(parts: Array<string | null>): string | null {
  const facts = parts.filter((part): part is string => Boolean(part));
  return facts.length > 0 ? facts.join(' ') : null;
}

function escalation(
  reasonCode: PartnerBrainReasonCode,
  text: string,
  priority: 'normal' | 'high' | 'urgent',
  matchedIntent: string,
  actionRecommendation: PartnerBrainResult['actionRecommendation'] = null,
): PartnerBrainResult {
  return Object.freeze({
    decision: decision('escalate', text, 'review_required', 0.98, reasonCode),
    matchedIntent,
    actionRecommendation,
    handoffRecommendation: Object.freeze({ priority, reasonCode }),
  });
}

function missingKnowledge(reasonCode: PartnerBrainReasonCode = 'knowledge_missing'): PartnerBrainResult {
  return Object.freeze({
    decision: decision(
      'clarify',
      'В данных объекта нет подтверждённой информации. Нужна проверка сотрудника.',
      'review_required',
      0.99,
      reasonCode,
    ),
    matchedIntent: 'missing_knowledge',
    actionRecommendation: null,
    handoffRecommendation: Object.freeze({ priority: 'normal' as const, reasonCode }),
  });
}

export function decidePartnerCommunication(input: BrainInput): PartnerBrainResult {
  const { principal, context, canonical, session, knowledge } = input;
  if (
    !isAuthenticatedPartnerPrincipal(principal)
    || !isPartnerCanonicalResolution(canonical)
    || principal.accountId !== canonical.accountId
    || principal.partnerId !== context.identity.partnerId
    || principal.externalPartnerAccountId !== context.identity.accountId
    || session.accountId !== principal.accountId
  ) return escalation('sensitive_request_requires_review', 'Нужна проверка сотрудника.', 'urgent', 'scope_conflict');

  const message = context.message.text;
  if (canonical.status === 'unresolved') {
    return escalation(canonical.reasonCode, 'Не удалось подтвердить объект или бронирование. Нужна проверка сотрудника.', 'urgent', 'mapping');
  }
  if (FINANCIAL.test(message)) {
    return escalation(
      'financial_request_requires_review',
      'Запрос на возврат или компенсацию передан сотруднику для решения.',
      'high',
      'financial_request',
    );
  }
  if (SENSITIVE.test(message)) {
    return escalation(
      'sensitive_request_requires_review',
      'Запрос требует проверки сотрудника.',
      'high',
      'sensitive_request',
    );
  }
  if (URGENT_ACCESS.test(message)) {
    return escalation(
      'urgent_access_issue',
      'Проблема с доступом срочно передана сотруднику.',
      'urgent',
      'urgent_access',
    );
  }
  if (MAINTENANCE.test(message)) {
    return escalation(
      'maintenance_issue',
      'Проблема в квартире передана сотруднику для проверки.',
      'high',
      'maintenance',
      Object.freeze({ actionType: 'maintenance_issue', priority: 'high', reasonCode: 'maintenance_issue' }),
    );
  }

  if (knowledge.status !== 'found') {
    return missingKnowledge(knowledge.status === 'lookup_failed' ? 'knowledge_lookup_failed' : 'knowledge_missing');
  }
  if (knowledge.knowledge.propertyId !== canonical.propertyId) {
    return escalation('property_mapping_conflict', 'Не удалось подтвердить данные объекта. Нужна проверка сотрудника.', 'urgent', 'scope_conflict');
  }

  const facts = knowledge.knowledge;
  if (WIFI.test(message)) {
    if (!facts.wifiPassword) return missingKnowledge();
    const text = joinFacts([
      facts.wifiName ? `Сеть Wi-Fi: ${facts.wifiName}.` : null,
      `Пароль: ${facts.wifiPassword}.`,
      facts.wifiNotes,
    ]);
    return Object.freeze({
      decision: decision('reply', text, 'auto_allowed', 0.99, 'grounded_wifi'),
      matchedIntent: 'wifi', actionRecommendation: null, handoffRecommendation: null,
    });
  }
  if (CHECKIN.test(message)) {
    const text = joinFacts([facts.checkinInstructions, facts.accessNotes, facts.doorCodeNotes, facts.checkinTime]);
    if (!text) return missingKnowledge();
    return Object.freeze({
      decision: decision('reply', text, 'auto_allowed', 0.96, 'grounded_checkin'),
      matchedIntent: 'checkin', actionRecommendation: null, handoffRecommendation: null,
    });
  }
  if (CHECKOUT.test(message)) {
    const text = joinFacts([facts.checkoutNotes, facts.checkoutTime]);
    if (!text) return missingKnowledge();
    return Object.freeze({
      decision: decision('reply', text, 'auto_allowed', 0.96, 'grounded_checkout'),
      matchedIntent: 'checkout', actionRecommendation: null, handoffRecommendation: null,
    });
  }
  if (PARKING.test(message)) {
    const text = joinFacts([facts.parkingRules, facts.parkingPaidOrFree, facts.parkingLocationNotes]);
    if (!text) return missingKnowledge();
    return Object.freeze({
      decision: decision('reply', text, 'auto_allowed', 0.96, 'grounded_parking'),
      matchedIntent: 'parking', actionRecommendation: null, handoffRecommendation: null,
    });
  }
  if (HOUSE_RULE.test(message)) {
    const text = joinFacts([facts.houseRules, facts.quietHours]);
    if (!text) return missingKnowledge();
    return Object.freeze({
      decision: decision('reply', text, 'auto_allowed', 0.94, 'grounded_house_rule'),
      matchedIntent: 'house_rule', actionRecommendation: null, handoffRecommendation: null,
    });
  }

  return Object.freeze({
    decision: decision(
      'clarify',
      'В данных объекта нет подтверждённого ответа на этот вопрос. Нужна проверка сотрудника.',
      'review_required',
      0.9,
      'unsupported_property_question',
    ),
    matchedIntent: 'unsupported_property_question',
    actionRecommendation: null,
    handoffRecommendation: Object.freeze({
      priority: 'normal' as const,
      reasonCode: 'unsupported_property_question' as const,
    }),
  });
}

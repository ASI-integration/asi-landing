/**
 * Message Routing Engine
 *
 * Determines HOW a message should be handled before any LLM or template logic runs.
 * Returns a RouteDecision with type + optional scenario.
 *
 * Route types:
 *   AUTO_REPLY  — LLM generates a reply from context (general questions, greetings)
 *   SCENARIO    — A deterministic scenario handles it (pricing, check-in, check-out, payment)
 *   ESCALATE    — Hand off to a human operator immediately
 *   ACTION      — Trigger a side-effecting action (create ops task, payment link, etc.)
 *
 * Design principle: deterministic rules run first (keyword + intent signal),
 * then confidence-based fallback to AUTO_REPLY.  The router is intentionally
 * conservative — it escalates on uncertainty rather than hallucinating.
 */

import {
  IntentCategory,
  IntentResult,
  ClassifyResult,
  MessageCategory,
  RouteDecision,
  RouteType,
  ScenarioType,
} from './types';

// ─── Keyword tables ────────────────────────────────────────────────────────────

const EMERGENCY_KEYWORDS = [
  'lockout', 'locked out', 'can\'t get in', 'no entry',
  'flooding', 'flood', 'water leak',
  'gas leak', 'gas smell',
  'fire', 'smoke',
  'no power', 'electricity out',
] as const;

const PRICING_KEYWORDS = [
  'price', 'cost', 'how much', 'rate', 'fee',
  'цена', 'стоимость', 'сколько стоит', 'тариф',
] as const;

const OPS_ESCALATION_KEYWORDS = [
  'broken', 'not working', 'dirty', 'trash', 'damage',
  'noise', 'neighbour', 'neighbor', 'party',
  'сломан', 'не работает', 'грязно', 'мусор', 'поломка',
] as const;

const FRUSTRATION_SIGNALS = [
  'useless', 'terrible', 'awful', 'unacceptable', 'ridiculous',
  'speak to a human', 'speak to a person', 'talk to someone', 'real person',
  'manager', 'supervisor',
  'бесполезно', 'ужасно', 'недопустимо', 'менеджер', 'живой человек',
] as const;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Route a message to the appropriate handler.
 *
 * @param text         Raw message text
 * @param intentResult Detected intent + confidence
 * @param classifyResult Classification (category + slots)
 * @returns RouteDecision
 */
export function routeMessage(
  text: string,
  intentResult: IntentResult,
  classifyResult: ClassifyResult,
): RouteDecision {
  const lower = text.toLowerCase();
  const { intent, confidence: intentConfidence } = intentResult;
  const { category, slots } = classifyResult;

  // ── 1. Emergency / safety → always escalate ───────────────────────────────
  if (EMERGENCY_KEYWORDS.some(kw => lower.includes(kw))) {
    return route('ESCALATE', undefined, 'emergency_keyword_match', 1.0);
  }

  if (category === MessageCategory.Issue && slots.isUrgent && slots.isAccessRelated) {
    return route('ESCALATE', undefined, 'urgent_access_issue', 1.0);
  }

  // ── 2. Frustration / explicit human request → escalate ───────────────────
  if (FRUSTRATION_SIGNALS.some(kw => lower.includes(kw))) {
    return route('ESCALATE', undefined, 'frustration_signal', 0.9);
  }

  // ── 3. Ops-level issues → ACTION (create ops task) ────────────────────────
  if (
    OPS_ESCALATION_KEYWORDS.some(kw => lower.includes(kw)) ||
    intent === IntentCategory.IssueReport
  ) {
    return route('ACTION', undefined, 'ops_issue_detected', 0.85);
  }

  // ── 4. Intent-based scenario routing ─────────────────────────────────────
  if (intent === IntentCategory.BookingInquiry && intentConfidence >= 0.6) {
    if (PRICING_KEYWORDS.some(kw => lower.includes(kw))) {
      return route('SCENARIO', 'pricing', 'pricing_keyword_plus_booking_intent', intentConfidence);
    }
    return route('AUTO_REPLY', undefined, 'booking_inquiry_general', intentConfidence);
  }

  if (intent === IntentCategory.CheckInInfo && intentConfidence >= 0.6) {
    return route('SCENARIO', 'check_in', 'check_in_intent', intentConfidence);
  }

  if (intent === IntentCategory.CheckOut && intentConfidence >= 0.6) {
    return route('SCENARIO', 'check_out', 'check_out_intent', intentConfidence);
  }

  if (intent === IntentCategory.PaymentRequest && intentConfidence >= 0.6) {
    return route('SCENARIO', 'payment', 'payment_intent', intentConfidence);
  }

  // ── 5. Low-confidence unknown → escalate ─────────────────────────────────
  if (intent === IntentCategory.Unknown && intentConfidence < 0.4) {
    return route('ESCALATE', undefined, 'low_confidence_unknown', intentConfidence);
  }

  // ── 6. Pricing keyword without strong intent ──────────────────────────────
  if (PRICING_KEYWORDS.some(kw => lower.includes(kw))) {
    return route('SCENARIO', 'pricing', 'pricing_keyword_match', 0.75);
  }

  // ── 7. Default: let LLM handle it ────────────────────────────────────────
  return route('AUTO_REPLY', undefined, 'general_fallback', 0.5);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function route(
  type: RouteType,
  scenario: ScenarioType | undefined,
  reason: string,
  confidence: number,
): RouteDecision {
  return { type, scenario, reason, confidence };
}

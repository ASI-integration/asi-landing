import { EscalationReason, MessageCategory, IntentCategory, SessionTimelineEntry } from './types';

export function getAutonomousIntentEscalationThreshold(): number {
  const raw = process.env.AUTONOMOUS_INTENT_ESCALATION_THRESHOLD;
  if (raw === undefined || raw === '') return 0.42;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.42;
}

function looksLikePaymentComplaintCombo(text: string): boolean {
  const t = text.toLowerCase();
  const paymentish =
    /(оплат|платеж|платёж|payment|оплатил|заплатил|pay\b|refund|chargeback|yookassa|stripe|карт|картой|евро|usd|rub|руб)/i.test(
      t,
    );
  const complaintish =
    /(жалоб|complaint|scam|обман|верните|возврат|refund|chargeback|спор|dispute|мошен|не\s*засел|не заселили)/i.test(
      t,
    );
  return paymentish && complaintish;
}

// ─── Frustration signal detection ─────────────────────────────────────────────

const FRUSTRATION_RE =
  /(terrible|awful|unacceptable|disgusting|furious|angry|outrageous|ridiculous|fed\s+up|scam|fraud|horrible|pathetic|worst|incompetent|useless|never\s+again|lawsuit|sue\s+you|ужасно|невозможно|безобразие|хватит|надоело|отвратительно|бесит|мошенники|это\s+что\s+такое|я\s+не\s+понимаю|так\s+нельзя|скандал|идиоты|безответственно)/i;

function looksLikeFrustration(text: string): boolean {
  return FRUSTRATION_RE.test(text);
}

// ─── Timeline-based signal detection ─────────────────────────────────────────

const MIN_WORD_OVERLAP_RATIO = 0.75;
const MIN_MEANINGFUL_WORDS   = 5;   // require vocabulary of this size before comparing
const REPEATED_QUESTION_THRESHOLD = 2;
const NO_PROGRESS_TURNS = 3;

// Common stop-words to exclude from overlap calculation so short functional
// words ("how", "do", "check") don't artificially inflate the ratio.
const STOP_WORDS = new Set([
  'the','and','for','are','but','not','you','all','can','her','was','one',
  'our','out','day','get','has','him','his','how','its','may','nor','now',
  'off','old','own','say','she','too','use','via','who','why','yet',
  // RU
  'как','это','все','для','что','или','его','они','мне','мой','так',
  'есть','было','вам','нас','нет','уже','если','чтобы',
]);

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w)),
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) { if (b.has(w)) common++; }
  return common / Math.min(a.size, b.size);
}

/**
 * Detect if the current user message is essentially a repeat of something
 * already asked in the timeline (same question sent 2+ times).
 * Requires a sufficiently rich vocabulary to avoid false positives on short
 * functional messages ("how do I check in" vs "how do I check out").
 */
function detectRepeatedQuestion(
  currentText: string,
  timeline: SessionTimelineEntry[],
): boolean {
  const currentWords = wordsOf(currentText);
  if (currentWords.size < MIN_MEANINGFUL_WORDS) return false;
  const priorUserMessages = timeline.filter(e => e.role === 'user');
  let repeats = 0;
  for (const entry of priorUserMessages) {
    const entryWords = wordsOf(entry.text);
    if (entryWords.size < MIN_MEANINGFUL_WORDS) continue;
    if (overlapRatio(currentWords, entryWords) >= MIN_WORD_OVERLAP_RATIO) {
      repeats++;
      if (repeats >= REPEATED_QUESTION_THRESHOLD) return true;
    }
  }
  return false;
}

/**
 * Detect no-progress: the last N consecutive bot turns were all clarifying
 * questions (assistant messages that start with known ask-patterns) while the
 * user kept responding. If we've been stuck asking for the same thing for
 * NO_PROGRESS_TURNS rounds, it's time for a human.
 */
function detectNoProgress(timeline: SessionTimelineEntry[]): boolean {
  const assistantTurns = timeline.filter(e => e.role === 'assistant');
  if (assistantTurns.length < NO_PROGRESS_TURNS) return false;
  // Look at the last N assistant messages — if all of them look like clarifying questions
  const last = assistantTurns.slice(-NO_PROGRESS_TURNS);
  const askPattern =
    /please (send|share|provide|describe|tell)|пришлите|уточните|расскажите|укажите|опишите/i;
  return last.every(e => askPattern.test(e.text));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type AutonomousEscalationSignal = {
  reason: EscalationReason;
  /** Short summary for operators and audit (no full raw body). */
  summary: string;
};

/**
 * Rule-based escalation (no LLM). Runs after intent + confidence are known.
 * Returns null when the autonomous layer should not short-circuit to escalation.
 *
 * `timeline` is optional for backward compatibility; pass it when available
 * to enable repeated-question and no-progress detection.
 */
export function evaluateAutonomousEscalation(input: {
  text: string;
  intent: IntentCategory;
  intentConfidence: number;
  classificationCategory: MessageCategory;
  timeline?: SessionTimelineEntry[];
}): AutonomousEscalationSignal | null {
  if (
    input.classificationCategory === MessageCategory.Start ||
    input.classificationCategory === MessageCategory.Greeting
  ) {
    return null;
  }

  const threshold = getAutonomousIntentEscalationThreshold();

  if (input.intentConfidence < threshold) {
    return {
      reason: EscalationReason.LowIntentConfidence,
      summary: `intent=${input.intent} conf=${input.intentConfidence.toFixed(3)}<${threshold}`,
    };
  }

  if (looksLikePaymentComplaintCombo(input.text)) {
    return {
      reason: EscalationReason.PaymentComplaint,
      summary: 'payment_or_refund_with_complaint_signals',
    };
  }

  if (looksLikeFrustration(input.text)) {
    return {
      reason: EscalationReason.RequiresOperator,
      summary: 'user_frustration_signal_detected',
    };
  }

  if (input.timeline && input.timeline.length > 0) {
    if (detectRepeatedQuestion(input.text, input.timeline)) {
      return {
        reason: EscalationReason.RequiresOperator,
        summary: `repeated_question_detected (${REPEATED_QUESTION_THRESHOLD}+ times)`,
      };
    }

    if (detectNoProgress(input.timeline)) {
      return {
        reason: EscalationReason.RequiresOperator,
        summary: `no_progress_in_${NO_PROGRESS_TURNS}_turns`,
      };
    }
  }

  return null;
}

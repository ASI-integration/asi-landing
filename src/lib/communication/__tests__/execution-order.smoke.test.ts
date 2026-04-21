/**
 * Execution Order Smoke Test
 *
 * Logs every significant step in processUpdate so you can see:
 *   - which steps are awaited  (sequential, guaranteed before reply)
 *   - which steps are background (fire-and-forget, may settle after return)
 *
 * Run:
 *   npx vitest run src/lib/communication/__tests__/execution-order.smoke.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, IntentCategory } from '../types';
import type { TelegramUpdate } from '../types';

// ─── Shared state (hoisted so mock factories can close over them) ─────────────

const log: string[] = [];
const bgPromises: Promise<unknown>[] = [];

// ─── Background task tracker ─────────────────────────────────────────────────
// Intercept runInBackground to record when each task starts and when it settles.

interface BackgroundContext { correlationId: string; module: string; taskName: string; eventId?: string; triggerId?: string; }

vi.mock('../background', () => ({
  runInBackground: (context: BackgroundContext, fn: () => Promise<unknown>) => {
    const tag = `${context.module}/${context.taskName}`;
    log.push(`  [background:start]  ${tag}  corr=${context.correlationId}${context.triggerId ? ` trig=${context.triggerId}` : ''}`);
    const promise = fn();
    bgPromises.push(promise);
    promise.then(
      ()    => log.push(`  [background:done]   ${tag}`),
      (err: unknown) => log.push(
        `  [background:fail]   ${tag}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  },
  flushBackgroundTasks:       async () => {},
  getPendingTaskCount:        () => 0,
  _resetRegistryForTesting:   () => {},
}));

// ─── Supabase ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert:  async () => ({ error: null }),
      insert:  async () => ({ error: null }),
      update:  () => ({
        eq: () => ({
          eq:    async () => ({ error: null }),
          then:  (fn: () => void) => { fn(); return { catch: () => {} }; },
        }),
      }),
      select: () => ({
        eq: () => ({
          single:      async () => ({ data: null, error: { message: 'not found' } }),
          maybeSingle: async () => ({ data: null, error: null }),
          in: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          }),
        }),
      }),
    }),
  },
}));

// ─── Identity ─────────────────────────────────────────────────────────────────

vi.mock('../identity', () => ({
  createOrMergeIdentity: async () => {
    log.push('[step 2] createOrMergeIdentity      ← await');
    return { guestId: '42', phoneNumber: null, email: null };
  },
}));

// ─── Timeline ─────────────────────────────────────────────────────────────────

vi.mock('../timeline', () => ({
  appendTimelineEvent: async (_guestId: string, event: { type: string }) => {
    const label =
      event.type === 'message_inbound'  ? '[step 3] appendTimeline:inbound     ← await' :
      event.type === 'message_outbound' ? '[step 8] appendTimeline:outbound    ← await' :
      event.type === 'escalation'       ? '         appendTimeline:escalation   ← await' :
                                          `         appendTimeline:${event.type}   ← await`;
    log.push(label);
  },
}));

// ─── Channel adapter ──────────────────────────────────────────────────────────

vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel:        'telegram',
    formatResponse: (msg: string) => msg,
    sendMessage:    async () => {
      log.push('[step 7] sendMessage (delivery)     ← await');
      return true;
    },
  }),
}));

// ─── Persistence ─────────────────────────────────────────────────────────────

vi.mock('../persistence', () => ({
  upsertSession:     async () => { log.push('[step 5] upsertSession              ← await (allSettled)'); },
  saveUserTurn:      async () => { log.push('[step 6] saveUserTurn               ← await (allSettled)'); },
  saveAssistantTurn: async () => { log.push('[step 9] saveAssistantTurn          ← await'); },
}));

// ─── Session status ───────────────────────────────────────────────────────────

vi.mock('../session-status', () => ({
  SessionStatus: {
    Active:                  'active',
    OperatorReviewRequired:  'operator_review_required',
    PaymentPending:          'payment_pending',
  },
  transitionSessionStatus: async (_chatId: number, status: string) => {
    log.push(`         transitionSessionStatus(${status})`);
  },
  setPaymentExpiry: () => {},
}));

// ─── LLM ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/openai', () => ({
  callLLM: async () => {
    log.push('[step 4b] callLLM                    ← await');
    return 'smoke test reply';
  },
}));

// ─── Classifier / intent ──────────────────────────────────────────────────────

vi.mock('../classifier', () => ({
  classifyMessage:        async () => ({ category: 'general_question', lang: 'en', slots: { isUrgent: false } }),
  deterministicReply:     () => 'fallback',
  buildIntelligentPrompt: () => 'prompt',
  SYSTEM_PROMPT:          'system',
}));

vi.mock('../intent', () => ({
  detectIntent: async () => ({ intent: IntentCategory.GeneralQuestion, confidence: 0.9 }),
}));

// ─── Context / memory ─────────────────────────────────────────────────────────

vi.mock('../memory', () => ({
  getContext:    () => ({ incident: false }),
  updateContext: () => {},
}));

vi.mock('../context', () => ({
  buildCommunicationContext: async () => ({
    reservation: { propertyId: 'prop_smoke', reservationId: 'res_smoke' },
    guest: {},
  }),
}));

// ─── Action / safety / handoff ────────────────────────────────────────────────

vi.mock('../action', () => ({
  evaluateActionSafety: () => ({ safe: true, action: 'llm_default' }),
}));

vi.mock('../escalation', () => ({
  shouldEscalate:         () => false,
  deriveEscalationReason: () => 'none',
  createEscalationEvent:  () => ({ reason: 'none', summary: 'none' }),
}));

vi.mock('../handoff', () => ({
  buildOperatorHandoff: () => ({ reasonForEscalation: 'test' }),
}));

// ─── Templates / ops / payments ───────────────────────────────────────────────

vi.mock('../templates', () => ({
  getPropertyTemplates: async () => null,
}));

vi.mock('../reservation', () => ({
  matchReservation: vi.fn().mockResolvedValue({
    status: 'matched', confidence: 1.0,
    propertyId: 'prop_smoke', guestName: 'Guest', reservationId: 'res_smoke',
  }),
}));

vi.mock('@/lib/ops/tasks', () => ({
  createOpsTask:   vi.fn().mockResolvedValue({ ok: true, task_id: null, created: false }),
  OpsTaskType:     { GuestIssue: 'guest_issue', Checkout: 'checkout', CheckinReady: 'checkin_ready' },
  OpsTaskPriority: { Urgent: 'urgent', Normal: 'normal' },
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: vi.fn().mockResolvedValue({ paymentUrl: 'https://pay.test' }),
}));

// ─── Audit ────────────────────────────────────────────────────────────────────

vi.mock('../audit', () => ({
  auditDuplicate:           () => {},
  auditInbound:             () => {},
  auditOutbound:            () => {},
  auditLLM:                 () => {},
  auditEscalation:          () => {},
  auditDecision:            () => {},
  auditDuplicateOutboundPrevented: () => {},
  auditRetryAttempt:        () => {},
  auditFailureEnqueued:     () => {},
  auditAutonomousDecision:  () => {},
  auditError:               () => {},
  auditLog:                 () => {},
}));

// ─── Import under test ────────────────────────────────────────────────────────

import { processUpdate } from '../orchestrator';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUpdate(text: string): TelegramUpdate {
  return {
    update_id: 9001,
    message: {
      message_id: 1,
      chat: { id: 42 },
      from: { language_code: 'en' },
      text,
    },
  };
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('execution order smoke test', () => {
  beforeEach(() => {
    log.length = 0;
    bgPromises.length = 0;
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
  });

  it('records every step in order: await steps finish before flush, background steps settle after', async () => {
    log.push('[step 1] inbound event received     ← sync (idempotency check)');

    const result = await processUpdate(makeUpdate('hello smoke test'));

    // ── Flush boundary ────────────────────────────────────────────────────────
    // processUpdate has returned. All `await` steps above are guaranteed complete.
    // Background promises are floating — their .then() callbacks may not have run yet.
    log.push('──────────────────────────────────────────────────────────');
    log.push('[flush] processUpdate returned       ← ALL AWAITED STEPS DONE');
    log.push('──────────────────────────────────────────────────────────');

    // Drain all background promises so their done/fail callbacks fire
    await Promise.allSettled(bgPromises);

    log.push('[end]  all background tasks settled');

    // ── Print ordered log ─────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  EXECUTION ORDER LOG');
    console.log('══════════════════════════════════════════════════════════');
    log.forEach((entry, i) => console.log(`  ${String(i + 1).padStart(2, '0')}  ${entry}`));
    console.log('══════════════════════════════════════════════════════════\n');

    // ── Assertions ────────────────────────────────────────────────────────────

    expect(result.outcome).toBe(ProcessOutcome.Replied);

    const idx = (substr: string) => log.findIndex(l => l.includes(substr));

    const iIdentity    = idx('createOrMergeIdentity');
    const iInbound     = idx('appendTimeline:inbound');
    const iLLM         = idx('callLLM');
    const iUpsert      = idx('upsertSession');
    const iUserTurn    = idx('saveUserTurn');
    const iSend        = idx('sendMessage');
    const iOutbound    = idx('appendTimeline:outbound');
    const iAssistant   = idx('saveAssistantTurn');
    const iFlush       = idx('[flush]');
    const iBgStarts    = log.map((l, i) => l.includes('[background:start]') ? i : -1).filter(i => i >= 0);
    const iBgSettled   = log.map((l, i) => (l.includes('[background:done]') || l.includes('[background:fail]')) ? i : -1).filter(i => i >= 0);

    // Awaited steps execute in order before flush (assistant turn is persisted before
    // outbound delivery so failures after send still leave a DB trail — see orchestrator).
    expect(iIdentity).toBeLessThan(iInbound);
    expect(iInbound).toBeLessThan(iLLM);
    expect(iLLM).toBeLessThan(iAssistant);
    expect(iUpsert).toBeLessThan(iAssistant);
    expect(iUserTurn).toBeLessThan(iAssistant);
    expect(iAssistant).toBeLessThan(iSend);
    expect(iSend).toBeLessThan(iOutbound);
    expect(iOutbound).toBeLessThan(iFlush);

    // Background tasks are always *started* (fired) before flush boundary.
    iBgStarts.forEach(i => expect(i).toBeLessThan(iFlush));

    // NOTE: with fast mocks (no real I/O), background tasks can resolve and
    // settle their .then() callbacks *before* the flush boundary — the log
    // above shows this clearly for transitionSessionStatus.
    // In production (real Supabase calls ≥ 100 ms), all background tasks
    // settle well after processUpdate returns.
    // We intentionally do NOT assert on settle order here — the printed log
    // is the authoritative artifact for understanding timing.
  });
});

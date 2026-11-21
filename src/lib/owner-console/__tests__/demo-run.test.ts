import { describe, expect, it, beforeEach } from 'vitest';
import { ownerDemoCorsHeaders } from '@/lib/owner-console/cors';
import {
  assertSandboxBody,
  DEMO_STEP_IDS,
  DEMO_STEP_MS,
  readDemoRun,
  resetDemoRunsForTests,
  SandboxRejectedError,
  startDemoRun,
} from '@/lib/owner-console/demo-run';
import { GET, OPTIONS, POST } from '@/app/api/owner/demo/route';

describe('owner demo sandbox', () => {
  beforeEach(() => {
    resetDemoRunsForTests();
  });

  it('plays the hospitality checkout in four steps and then locks the audit entry', () => {
    const started = 1_700_000_000_000;
    const first = startDemoRun('en', started);
    expect(first.llmTokens).toBe(0);
    expect(first.sandbox).toBe(true);
    expect(first.steps.map((step) => step.id)).toEqual([...DEMO_STEP_IDS]);
    expect(first.steps.map((step) => step.state)).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(first.steps[0].title).toBe('Event Received (Guest Checkout)');
    expect(first.audit).toBeNull();

    const mid = readDemoRun(first.runId, started + DEMO_STEP_MS * 2);
    expect(mid?.steps.map((step) => step.state)).toEqual(['done', 'done', 'active', 'pending']);

    const last = readDemoRun(first.runId, started + DEMO_STEP_MS * 3);
    expect(last?.steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'active']);

    const done = readDemoRun(first.runId, started + DEMO_STEP_MS * 4);
    expect(done?.done).toBe(true);
    expect(done?.steps.every((step) => step.state === 'done')).toBe(true);
    expect(done?.steps[3].title).toBe('Operation Cost & Immutable Audit Entry Logged');
    expect(done?.audit).toMatchObject({ immutable: true, currency: 'USD', total: 39 });
    expect(readDemoRun(first.runId, started + DEMO_STEP_MS * 8)?.audit?.id).toBe(done?.audit?.id);
  });

  it('rejects paid-model fields and unknown scenarios', () => {
    expect(assertSandboxBody({ scenario: 'hospitality-checkout', lang: 'ru' })).toEqual({ lang: 'ru' });
    expect(() => assertSandboxBody({ prompt: 'do it', model: 'gpt' })).toThrow(SandboxRejectedError);
    expect(() => assertSandboxBody({ scenario: 'other' })).toThrow(SandboxRejectedError);
  });

  it('allows the two marketing origins and withholds others', () => {
    const allowed = ownerDemoCorsHeaders(new Request('https://app.asi-global.ru/api/owner/demo', {
      headers: { origin: 'https://www.guestautopilot.com' },
    }));
    expect(allowed.get('Access-Control-Allow-Origin')).toBe('https://www.guestautopilot.com');
    expect(allowed.get('X-LLM-Tokens')).toBe('0');

    const denied = ownerDemoCorsHeaders(new Request('https://app.asi-global.ru/api/owner/demo', {
      headers: { origin: 'https://evil.example' },
    }));
    expect(denied.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('serves the sandbox route without calling a model', async () => {
    const origin = 'https://asi-global.ru';
    const preflight = OPTIONS(new Request('https://app.asi-global.ru/api/owner/demo', { method: 'OPTIONS', headers: { origin } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);

    const created = await POST(new Request('https://app.asi-global.ru/api/owner/demo', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'hospitality-checkout', lang: 'ru' }),
    }));
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(body.llmTokens).toBe(0);
    expect(body.steps[0].title).toContain('выезд гостя');

    const rejected = await POST(new Request('https://app.asi-global.ru/api/owner/demo', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'paid', messages: [] }),
    }));
    expect(rejected.status).toBe(400);

    const missing = GET(new Request('https://app.asi-global.ru/api/owner/demo'));
    expect(missing.status).toBe(404);
  });
});

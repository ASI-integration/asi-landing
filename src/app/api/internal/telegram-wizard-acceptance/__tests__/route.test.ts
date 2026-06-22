import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReset = vi.fn();
const mockRunScenario = vi.fn();
const mockRunStep = vi.fn();

vi.mock('@/lib/communication/telegram-wizard-acceptance', () => ({
  assertWizardAcceptanceChatAllowed: (chatId: number | string) => {
    if (String(chatId) !== '99445001') throw new Error('chat_id_not_allowlisted:bad');
  },
  buildWizardV2AcceptanceSteps: () => [{ id: 'start', label: 'start', text: 'Хочу подключить квартиру' }],
  formatWizardAcceptanceTable: () => 'table',
  resetWizardAcceptanceState: (...args: unknown[]) => mockReset(...args),
  runWizardAcceptanceScenario: (...args: unknown[]) => mockRunScenario(...args),
  runWizardAcceptanceStep: (...args: unknown[]) => mockRunStep(...args),
  summarizeWizardAcceptanceRun: () => ({ ok: true }),
  validateWizardAcceptanceCrm: vi.fn(),
}));

import { POST } from '../route';

describe('POST /api/internal/telegram-wizard-acceptance', () => {
  beforeEach(() => {
    process.env.INTERNAL_TEST_SECRET = 'secret';
    mockReset.mockReset();
    mockRunScenario.mockReset();
    mockRunStep.mockReset();
    mockRunScenario.mockResolvedValue({
      ok: true,
      chatId: 99445001,
      steps: [],
      finalState: null,
      objectId: 'OBJ-0001',
      readinessPercent: 100,
      channels: [],
      rules: [],
      crm: { ok: true, failures: [] },
      objectsSafety: { ok: true, failures: [], preservedObjectIds: [] },
    });
    mockRunStep.mockResolvedValue({
      id: 'start',
      label: 'start',
      input: 'Хочу подключить квартиру',
      expected: 'ok',
      actual: 'ok',
      pass: true,
      failures: [],
      readinessPercent: 0,
      status: 'onboarding_started',
      editInPlace: false,
    });
    mockReset.mockReturnValue({
      ok: true,
      chatId: 99445001,
      previousRegistry: null,
      previousObjectCount: 0,
      previousActiveObjectId: null,
    });
  });

  it('rejects when secret header is missing', async () => {
    const req = new Request('https://example.test/api/internal/telegram-wizard-acceptance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reset', chatId: '99445001' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('runs full scenario for allowlisted chat', async () => {
    const req = new Request('https://example.test/api/internal/telegram-wizard-acceptance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-test-secret': 'secret',
      },
      body: JSON.stringify({ action: 'run', chatId: '99445001', resetTestState: true }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockRunScenario).toHaveBeenCalledWith({
      chatId: 99445001,
      resetTestState: true,
      preserveObjectIds: undefined,
    });
    expect(body.ok).toBe(true);
    expect(body.table).toBe('table');
  });

  it('rejects non-allowlisted chat id', async () => {
    const req = new Request('https://example.test/api/internal/telegram-wizard-acceptance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-test-secret': 'secret',
      },
      body: JSON.stringify({ action: 'reset', chatId: '931919812' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

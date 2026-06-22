import { NextResponse } from 'next/server';

import {
  assertWizardAcceptanceChatAllowed,
  buildWizardV2AcceptanceSteps,
  formatWizardAcceptanceTable,
  resetWizardAcceptanceState,
  runWizardAcceptanceScenario,
  runWizardAcceptanceStep,
  summarizeWizardAcceptanceRun,
  validateWizardAcceptanceCrm,
} from '@/lib/communication/telegram-wizard-acceptance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_TEST_SECRET;
  if (!expected) return false;
  return req.headers.get('x-internal-test-secret') === expected;
}

function parseChatId(body: Record<string, unknown>): number {
  const raw = String(body.chatId ?? body.test_chat_id ?? body.testChatId ?? '').trim();
  const chatId = Number(raw);
  if (!Number.isFinite(chatId) || chatId <= 0) {
    throw new Error('invalid_chat_id');
  }
  return chatId;
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  let chatId: number;
  try {
    chatId = parseChatId(body);
    assertWizardAcceptanceChatAllowed(chatId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_chat_id';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const action = String(body.action ?? 'run').trim().toLowerCase();

  try {
    if (action === 'reset') {
      const reset = resetWizardAcceptanceState(chatId);
      return NextResponse.json({ ok: true, action, reset });
    }

    if (action === 'step') {
      const text = String(body.text ?? '').trim() || undefined;
      const callbackData = String(body.callbackData ?? body.callback_data ?? '').trim() || undefined;
      if (!text && !callbackData) {
        return NextResponse.json({ ok: false, error: 'text_or_callback_required' }, { status: 400 });
      }
      const stepId = String(body.stepId ?? body.step_id ?? '').trim() || undefined;
      const step = stepId ? buildWizardV2AcceptanceSteps().find((item) => item.id === stepId) : undefined;
      const result = await runWizardAcceptanceStep({ chatId, text, callbackData, step });
      return NextResponse.json({ ok: result.pass, action, result });
    }

    if (action === 'crm') {
      const crm = await validateWizardAcceptanceCrm({
        chatId,
        crmContactId: String(body.crmContactId ?? body.crm_contact_id ?? '').trim() || undefined,
      });
      return NextResponse.json({ ok: crm.ok, action, crm });
    }

    if (action === 'run') {
      const resetTestState = body.resetTestState !== false && body.reset_test_state !== false;
      const preserveObjectIds = Array.isArray(body.preserveObjectIds)
        ? body.preserveObjectIds.map((item) => String(item))
        : Array.isArray(body.preserve_object_ids)
          ? body.preserve_object_ids.map((item) => String(item))
          : undefined;

      const run = await runWizardAcceptanceScenario({
        chatId,
        resetTestState,
        preserveObjectIds,
      });
      return NextResponse.json({
        ok: run.ok,
        action,
        run,
        summary: summarizeWizardAcceptanceRun(run),
        table: formatWizardAcceptanceTable(run.steps),
      });
    }

    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'acceptance_failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

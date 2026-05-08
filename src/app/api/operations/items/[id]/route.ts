import { NextResponse } from 'next/server';
import {
  appendOperationAuditEvent,
  escalateOperationToOperator,
  getOperationItem,
  updateChecklistItem,
  updateOperationStage,
} from '@/lib/operations/repository';
import { operationsApiErrorResponse, readJsonObject, requireOperationsContext } from '@/lib/operations/api';
import {
  checklistStageForWorkflowStage,
  operationsLinearStageOrder,
} from '@/lib/operations/demo-data';
import type {
  OperationsChecklistStage,
  OperationsChecklistStatus,
  OperationsWorkflowStage,
} from '@/lib/operations/types';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nextStage(stage: OperationsWorkflowStage): OperationsWorkflowStage | null {
  const index = operationsLinearStageOrder.indexOf(stage);
  if (index < 0) return null;
  return operationsLinearStageOrder[index + 1] ?? null;
}

export async function GET(_: Request, { params }: RouteParams) {
  const auth = await requireOperationsContext();
  if (!auth.ok) return auth.response;

  try {
    const item = await getOperationItem(auth.ctx, params.id);
    if (!item) return NextResponse.json({ ok: false, error: 'operation_item_not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return operationsApiErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireOperationsContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const action = optionalString(body.action);

  try {
    const current = await getOperationItem(auth.ctx, params.id);
    if (!current) return NextResponse.json({ ok: false, error: 'operation_item_not_found' }, { status: 404 });

    if (action === 'move_next_stage') {
      const stage = nextStage(current.stage);
      if (!stage) return NextResponse.json({ ok: false, error: 'no_next_stage' }, { status: 400 });
      const item = await updateOperationStage(auth.ctx, params.id, stage);
      return NextResponse.json({ ok: true, item });
    }

    if (action === 'update_stage') {
      const stage = optionalString(body.stage) as OperationsWorkflowStage | undefined;
      if (!stage) return NextResponse.json({ ok: false, error: 'stage_required' }, { status: 400 });
      const item = await updateOperationStage(auth.ctx, params.id, stage);
      return NextResponse.json({ ok: true, item });
    }

    if (action === 'update_checklist_item') {
      const checklistStage = optionalString(body.checklistStage) as OperationsChecklistStage | undefined;
      const checklistItemId = optionalString(body.checklistItemId);
      const status = optionalString(body.status) as OperationsChecklistStatus | undefined;
      if (!checklistStage || !checklistItemId || !status) {
        return NextResponse.json({ ok: false, error: 'checklist_update_fields_required' }, { status: 400 });
      }
      const item = await updateChecklistItem(auth.ctx, params.id, checklistStage, checklistItemId, status);
      return NextResponse.json({ ok: true, item });
    }

    if (action === 'mark_checkin_ready') {
      if (current.stage === 'new_inquiry' || current.stage === 'booking_intake') {
        await updateOperationStage(auth.ctx, params.id, 'pre_checkin');
      }
      await updateChecklistItem(auth.ctx, params.id, 'pre_checkin', 'pre-access-context-exists', 'done');
      await appendOperationAuditEvent(auth.ctx, params.id, {
        eventType: 'checkin_ready',
        label: 'Готовность к заезду отмечена',
        detail: 'Проверка выполнена без добавления фактов объекта в операционный слой.',
        tone: 'success',
      });
      return NextResponse.json({ ok: true, item: await getOperationItem(auth.ctx, params.id) });
    }

    if (action === 'mark_guest_checked_in') {
      await updateChecklistItem(auth.ctx, params.id, 'checkin', 'checkin-arrival-recorded', 'done');
      await updateOperationStage(auth.ctx, params.id, 'in_stay');
      await appendOperationAuditEvent(auth.ctx, params.id, {
        eventType: 'checked_in',
        label: 'Гость отмечен как заехавший',
        tone: 'success',
      });
      return NextResponse.json({ ok: true, item: await getOperationItem(auth.ctx, params.id) });
    }

    if (action === 'mark_checked_out') {
      await updateChecklistItem(auth.ctx, params.id, 'checkout', 'checkout-completed', 'done');
      await updateOperationStage(auth.ctx, params.id, 'review_followup');
      await appendOperationAuditEvent(auth.ctx, params.id, {
        eventType: 'checked_out',
        label: 'Выезд отмечен завершенным',
        tone: 'success',
      });
      return NextResponse.json({ ok: true, item: await getOperationItem(auth.ctx, params.id) });
    }

    if (action === 'escalate_operator') {
      const item = await escalateOperationToOperator(auth.ctx, params.id);
      return NextResponse.json({ ok: true, item });
    }

    if (action === 'activate_checklist_stage') {
      const stage = optionalString(body.stage) as OperationsWorkflowStage | undefined;
      if (!stage) return NextResponse.json({ ok: false, error: 'stage_required' }, { status: 400 });
      return NextResponse.json({ ok: true, checklistStage: checklistStageForWorkflowStage(stage) });
    }

    return NextResponse.json({ ok: false, error: 'unsupported_action' }, { status: 400 });
  } catch (err) {
    return operationsApiErrorResponse(err);
  }
}


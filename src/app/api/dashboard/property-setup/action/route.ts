import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  addPropertyAsset,
  addPropertySetupNote,
  blockPropertySetup,
  markChannelAccessReceived,
  markChannelAccessRequested,
  markOwnerInstructionSent,
  markReadyForChannelPreparation,
  markTestObjectSelected,
  requestMissingPropertySetupData,
  requestPropertyPhotos,
  startObjectDataCollection,
  upsertPropertySetupData,
  validatePropertySetup,
  type PropertyAssetType,
  type PropertySetupPayload,
} from '@/lib/booking-ops/owner-object-setup-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set([
  'start_data_collection',
  'update_property_data',
  'add_asset',
  'validate',
  'request_missing_data',
  'request_photos',
  'request_channel_access',
  'mark_channel_access_received',
  'mark_test_object_selected',
  'mark_ready_for_channel_preparation',
  'block_setup',
  'add_note',
  'mark_instruction_sent',
]);

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const action = String(body.action ?? '').trim();
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  }

  const ownerSetupId = typeof body.ownerSetupId === 'string' ? body.ownerSetupId : undefined;
  const propertySetupId = typeof body.propertySetupId === 'string' ? body.propertySetupId : undefined;
  const metadata = body.metadata && typeof body.metadata === 'object'
    ? body.metadata as Record<string, unknown>
    : undefined;

  try {
    switch (action) {
      case 'start_data_collection': {
        if (!ownerSetupId) throw new Error('Укажите ownerSetupId.');
        const propertySetup = await startObjectDataCollection(ownerSetupId, metadata);
        return NextResponse.json({ ok: true, propertySetup });
      }
      case 'update_property_data': {
        if (!ownerSetupId) throw new Error('Укажите ownerSetupId.');
        const payload = (body.payload ?? {}) as PropertySetupPayload;
        const propertySetup = await upsertPropertySetupData(ownerSetupId, payload, metadata);
        return NextResponse.json({ ok: true, propertySetup });
      }
      case 'add_asset': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const assetType = String(body.assetType ?? 'photo') as PropertyAssetType;
        const result = await addPropertyAsset(propertySetupId, {
          assetType,
          storageRef: typeof body.storageRef === 'string' ? body.storageRef : null,
          safeLabel: typeof body.safeLabel === 'string' ? body.safeLabel : null,
        }, metadata);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'validate': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const propertySetup = await validatePropertySetup(propertySetupId);
        return NextResponse.json({ ok: true, propertySetup });
      }
      case 'request_missing_data': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const result = await requestMissingPropertySetupData(propertySetupId, metadata);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'request_photos': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const result = await requestPropertyPhotos(propertySetupId, metadata);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'request_channel_access': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const propertySetup = await markChannelAccessRequested(propertySetupId, metadata);
        return NextResponse.json({ ok: true, propertySetup });
      }
      case 'mark_channel_access_received': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const safeAccessRef = typeof body.safeAccessRef === 'string' ? body.safeAccessRef : null;
        const propertySetup = await markChannelAccessReceived(propertySetupId, safeAccessRef, metadata);
        return NextResponse.json({ ok: true, propertySetup });
      }
      case 'mark_test_object_selected': {
        if (!ownerSetupId || !propertySetupId) throw new Error('Укажите ownerSetupId и propertySetupId.');
        const ownerSetup = await markTestObjectSelected(ownerSetupId, propertySetupId, metadata);
        return NextResponse.json({ ok: true, ownerSetup });
      }
      case 'mark_ready_for_channel_preparation': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const propertySetup = await markReadyForChannelPreparation(propertySetupId, metadata);
        return NextResponse.json({ ok: true, propertySetup });
      }
      case 'block_setup': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const reason = typeof body.reason === 'string' ? body.reason : 'Заблокировано оператором';
        const propertySetup = await blockPropertySetup(propertySetupId, reason, metadata);
        return NextResponse.json({ ok: true, propertySetup });
      }
      case 'add_note': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const note = typeof body.note === 'string' ? body.note : '';
        if (!note.trim()) throw new Error('Укажите текст заметки.');
        const propertySetup = await addPropertySetupNote(propertySetupId, note, metadata);
        return NextResponse.json({ ok: true, propertySetup });
      }
      case 'mark_instruction_sent': {
        if (!ownerSetupId) throw new Error('Укажите ownerSetupId.');
        const ownerSetup = await markOwnerInstructionSent(ownerSetupId);
        return NextResponse.json({ ok: true, ownerSetup });
      }
      default:
        return NextResponse.json({ ok: false, message: 'Действие не поддерживается.' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}

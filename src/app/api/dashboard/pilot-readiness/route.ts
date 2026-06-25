import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { isOpsAdminEmail } from '@/lib/crm/access';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import { runPilotChainForProperty } from '@/lib/pilot-chain/orchestrator';
import {
  getPilotReadinessForProperty,
  listPilotObjectSnapshots,
  listPilotReadinessResults,
  upsertPilotObjectKnowledge,
  type PilotPropertyRow,
} from '@/lib/pilot-readiness/repository';
import { computePilotReadiness } from '@/lib/pilot-readiness/engine';
import { communicationModeToStorage, type CommunicationMode } from '@/lib/communication/communication-autopilot-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const propertyId = url.searchParams.get('propertyId')?.trim();
  const includeTest = url.searchParams.get('includeTest') === '1';

  if (propertyId) {
    const result = await getPilotReadinessForProperty(propertyId);
    if (!result) {
      return NextResponse.json({ ok: false, message: 'Объект не найден.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, result });
  }

  const results = await listPilotReadinessResults({ includeTest });
  const readyCount = results.filter((item) => item.ready).length;
  return NextResponse.json({
    ok: true,
    results,
    isOpsAdmin: isOpsAdminEmail(auth.session.email),
    summary: {
      total: results.length,
      ready: readyCount,
      notReady: results.length - readyCount,
    },
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const propertyId = String(body.propertyId ?? body.property_id ?? '').trim();
  if (!propertyId) {
    return NextResponse.json({ ok: false, message: 'Укажите объект.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { property_id: propertyId, active: true };
  if (body.objectName !== undefined) patch.object_name = String(body.objectName ?? '').trim();
  if (body.name !== undefined) patch.object_name = String(body.name ?? '').trim();
  if (body.address !== undefined) patch.address = String(body.address ?? '').trim();
  if (body.description !== undefined) patch.description = String(body.description ?? '').trim();
  if (body.rules !== undefined) patch.house_rules_text = String(body.rules ?? '').trim();
  if (body.checkInTime !== undefined) patch.check_in_time = String(body.checkInTime ?? '').trim();
  if (body.checkOutTime !== undefined) patch.check_out_time = String(body.checkOutTime ?? '').trim();
  if (body.wifiName !== undefined) patch.wifi_name = String(body.wifiName ?? '').trim();
  if (body.wifiPassword !== undefined) patch.wifi_password = String(body.wifiPassword ?? '').trim();
  if (body.accessNotes !== undefined) patch.access_notes = String(body.accessNotes ?? '').trim();
  if (body.bookingChannels !== undefined) patch.booking_channels = String(body.bookingChannels ?? '').trim();
  if (body.photosDeferred !== undefined) patch.photos_deferred = Boolean(body.photosDeferred);
  if (body.communicationMode !== undefined) {
    const mode = String(body.communicationMode ?? '').trim() as CommunicationMode;
    patch.communication_autopilot = communicationModeToStorage(mode);
  }
  if (body.pilotAcceptanceMarker !== undefined) {
    patch.pilot_acceptance_marker = String(body.pilotAcceptanceMarker ?? '').trim() || null;
  }

  const saved = await upsertPilotObjectKnowledge(patch as Partial<PilotPropertyRow> & { property_id: string });
  if (!saved.ok) {
    return NextResponse.json({ ok: false, message: saved.error ?? 'Не удалось сохранить объект.' }, { status: 500 });
  }

  await syncAutoOpsTasks();
  await runPilotChainForProperty(propertyId);
  const result = await getPilotReadinessForProperty(propertyId);
  return NextResponse.json({ ok: true, result });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  const snapshots = await listPilotObjectSnapshots();
  await syncAutoOpsTasks();
  const results = snapshots.map((snapshot) => computePilotReadiness(snapshot));
  return NextResponse.json({
    ok: true,
    synced: true,
    results,
  });
}

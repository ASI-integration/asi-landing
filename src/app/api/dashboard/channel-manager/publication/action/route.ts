import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  addPublicationNote,
  assertSafePublicationInput,
  blockPublicationPackage,
  buildPublicationPackage,
  initializePublicationPackage,
  markPublicationPending,
  markPublishedPlaceholder,
  markReadyForPublication,
  markReadyForReview,
  parsePublicationChannelKeys,
  parsePublicationProvider,
  selectAllSupportedPublicationChannels,
  selectPublicationChannels,
  validatePublicationPackage,
} from '@/lib/booking-ops/channel-publishing-preparation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set([
  'initialize_package', 'build_package', 'validate_package', 'select_channels',
  'select_all_supported_channels', 'mark_ready_for_review', 'mark_ready_for_publication',
  'mark_publication_pending', 'mark_published_placeholder', 'block_publication', 'add_note',
]);

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>;
    assertSafePublicationInput(body);
    const action = String(body.action ?? '');
    if (!ACTIONS.has(action)) return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
    const packageId = typeof body.packageId === 'string' ? body.packageId : '';
    const propertySetupId = typeof body.propertySetupId === 'string' ? body.propertySetupId : '';
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : undefined;
    let result;
    if (action === 'initialize_package') result = await initializePublicationPackage(propertySetupId, body.provider ? parsePublicationProvider(body.provider) : undefined, metadata);
    else if (action === 'build_package') result = await buildPublicationPackage(propertySetupId, { packageId: packageId || undefined, metadata });
    else if (action === 'validate_package') result = await validatePublicationPackage(packageId);
    else if (action === 'select_channels') result = await selectPublicationChannels(packageId, parsePublicationChannelKeys(body.channelKeys), metadata);
    else if (action === 'select_all_supported_channels') result = await selectAllSupportedPublicationChannels(packageId, metadata);
    else if (action === 'mark_ready_for_review') result = await markReadyForReview(packageId, metadata);
    else if (action === 'mark_ready_for_publication') result = await markReadyForPublication(packageId, metadata);
    else if (action === 'mark_publication_pending') result = await markPublicationPending(packageId, metadata);
    else if (action === 'mark_published_placeholder') result = await markPublishedPlaceholder(packageId, metadata);
    else if (action === 'block_publication') result = await blockPublicationPackage(packageId, String(body.reason ?? ''), metadata);
    else result = await addPublicationNote(packageId, String(body.note ?? ''), metadata);
    return NextResponse.json({ ok: true, package: result, realOtaPublishingEnabled: false });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось выполнить действие.' }, { status: 400 });
  }
}

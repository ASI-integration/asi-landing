import { NextResponse } from 'next/server';
import { optionalString, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { getMasterCard, listProperties, listPropertyMedia } from '@/lib/ops-foundation/repository';
import { channelManagerApiErrorResponse } from '@/lib/channel-manager/api';
import { computePropertyReadiness } from '@/lib/channel-manager/property-lifecycle';
import { listChannelManagerState } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const propertyId = optionalString(new URL(req.url).searchParams.get('propertyId'));
    const [properties, state] = await Promise.all([
      listProperties(auth.ctx),
      listChannelManagerState(auth.ctx, propertyId),
    ]);

    const property = propertyId
      ? properties.find((item) => item.id === propertyId) ?? null
      : properties[0] ?? null;

    let masterCard = null;
    let mediaCount = 0;
    if (property) {
      try {
        masterCard = await getMasterCard(auth.ctx, property.id);
      } catch {
        masterCard = null;
      }
      try {
        const media = await listPropertyMedia(auth.ctx, property.id);
        mediaCount = media.filter((item) => item.status === 'active').length;
      } catch {
        mediaCount = 0;
      }
    }

    const conflictCount = (state.reservations ?? []).filter((reservation) =>
      ['conflict', 'rejected_by_inventory', 'declined'].includes(reservation.status),
    ).length;

    const readiness = computePropertyReadiness({
      property,
      masterCard,
      mediaCount,
      channels: state.channels ?? [],
      conflictCount,
      discrepancyCount: state.shadowDiscrepancies?.length ?? 0,
    });

    return NextResponse.json({
      ok: true,
      propertyId: property?.id ?? null,
      mediaCount,
      readiness,
    });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}

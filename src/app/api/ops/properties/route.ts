import { NextResponse } from 'next/server';
import {
  opsFoundationApiErrorResponse,
  readJsonObject,
  requireOpsFoundationContext,
} from '@/lib/ops-foundation/api';
import { parseCreatePropertyInput } from '@/lib/ops-foundation/parsers';
import { createProperty, listProperties } from '@/lib/ops-foundation/repository';
import { linkPilotCrmContactToProperty } from '@/lib/crm/repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const properties = await listProperties(auth.ctx);
    return NextResponse.json({ ok: true, properties });
  } catch (err) {
    return opsFoundationApiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const input = parseCreatePropertyInput(body);
  if (!input) {
    return NextResponse.json({ ok: false, error: 'title_required' }, { status: 400 });
  }
  const crmContactId = typeof body.crmContactId === 'string' ? body.crmContactId.trim() : null;

  try {
    const property = await createProperty(auth.ctx, input);
    if (crmContactId) {
      try {
        await linkPilotCrmContactToProperty({ contactId: crmContactId, propertyId: property.id });
      } catch (error) {
        console.error('[ops/properties] CRM pilot link failed', {
          error: error instanceof Error ? error.message : String(error),
          crmContactId,
          propertyId: property.id,
        });
      }
    }
    return NextResponse.json({ ok: true, property }, { status: 201 });
  } catch (err) {
    return opsFoundationApiErrorResponse(err);
  }
}

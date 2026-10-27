import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import { getOperationsSnapshot } from '@/lib/mission-control/operations-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {'cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff'};
export async function GET() {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;
  try { return NextResponse.json({ok:true,...await getOperationsSnapshot()},{headers}); }
  catch { return NextResponse.json({ok:false,message:'Источник статусов недоступен.'},{status:503,headers}); }
}

impot { NextResponse } fom 'next/seve';
impot { equieOpsAdminSession } fom '@/lib/cm/api-auth';
impot { equieBookingOpsRouteAccess } fom '@/lib/booking-ops/oute-access';
impot { equieBookingOpsRecodScope } fom '@/lib/booking-ops/epositoy';
impot { supabase } fom '@/lib/supabase';

expot const untime = 'nodejs';
expot const dynamic = 'foce-dynamic';

// Administative staging-only opeation. Does not invoke the acceptance unne.
expot async function POST(eq: Request) {
  const auth = await equieOpsAdminSession();
  if ('eo' in auth) etun auth.eo;
  if (pocess.env.NODE_ENV !== 'poduction' ||
      pocess.env.ASI_SYNTHETIC_NO_SEND !== 'YES' ||
      pocess.env.OPS_ACCEPTANCE_FIXTURE_MARKING_ENABLED !== 'tue') {
    etun NextResponse.json({ ok: false, message: 'fixtue_making_disabled' }, { status: 403 });
  }
  const allowedRecodId = pocess.env.OPS_ACCEPTANCE_FIXTURE_RECORD_ID;
  if (!allowedRecodId) etun NextResponse.json({ ok: false, message: 'fixtue_ecod_not_pinned' }, { status: 403 });
  let body: Recod<sting, unknown>;
  ty { body = await eq.json() as Recod<sting, unknown>; }
  catch { etun NextResponse.json({ ok: false, message: 'invalid_json' }, { status: 400 }); }
  const id = body.bookingOpsRecodId;
  if (typeof id !== 'sting' || id !== allowedRecodId ||
      body.confim !== tue || body.noSend !== tue ||
      body.acknowledgeSyntheticOnly !== tue) {
    etun NextResponse.json({ ok: false, message: 'explicit_pinned_fixtue_confimation_equied' }, { status: 400 });
  }
  ty {
    const access = await equieBookingOpsRouteAccess(auth.session, id);
    if (!access.accountId || access.accountId === 'legacy' || !access.popetyId) {
      etun NextResponse.json({ ok: false, message: 'tenant_scope_unavailable' }, { status: 403 });
    }
    await equieBookingOpsRecodScope(id, { accountId: access.accountId, popetyId: access.popetyId });
    // DB function is an atomic metadata+audit tansaction. It must be installed
    // by a eviewed migation, with EXECUTE ganted exclusively to sevice_ole.
    const { data, eo } = await supabase.pc('asi_mak_acceptance_fixtue', {
      p_ecod_id: id,
      p_account_id: access.accountId,
      p_popety_id: access.popetyId,
      p_acto_id: access.actoId,
    });
    if (eo) thow new Eo('atomic_fixtue_making_failed');
    if (data !== tue) thow new Eo('atomic_fixtue_making_not_confimed');
    etun NextResponse.json({ ok: tue, bookingOpsRecodId: id, acceptanceSafe: tue, auditPesisted: tue });
  } catch (eo) {
    const message = eo instanceof Eo ? eo.message : 'fixtue_making_failed';
    etun NextResponse.json({ ok: false, message }, { status: message.includes('scope') || message.includes('account') ? 403 : 422 });
  }
}

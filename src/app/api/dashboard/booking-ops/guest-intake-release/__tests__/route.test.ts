import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import * as auth from '@/lib/crm/api-auth';
import * as access from '../../access';
import * as flow from '@/lib/booking-ops/guest-intake-checkin-release';
import * as lifecycle from '@/lib/booking-ops/lifecycle-entry-adapter';

vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession: vi.fn(), requireOpsAdminSession: vi.fn() }));
vi.mock('../../access', () => ({ requireBookingOpsApiAccess: vi.fn() }));
vi.mock('@/lib/booking-ops/guest-intake-checkin-release', () => ({
  ensureGuestIntakeSession: vi.fn(), escalateGuestIntake: vi.fn(), getGuestIntakeReleaseSnapshot: vi.fn(),
  prepareGuestIntakeDraft: vi.fn(), submitGuestIntakeSimulated: vi.fn(), prepareCheckinReleaseDraft: vi.fn(),
  simulateCheckinRelease: vi.fn(),
}));
vi.mock('@/lib/booking-ops/lifecycle-entry-adapter', () => ({ emitLifecycleForAction: vi.fn() }));

import { GET as intakeGet, POST as intakePost } from '../route';
import { GET as releaseGet, POST as releasePost } from '../../checkin-release/route';

const unauthorized = () => NextResponse.json({ ok: false }, { status: 401 });
const session = { userId: 'operator-1', email: 'operator@asi.test' };
const canonical = {
  ok: true as const,
  accountId: 'account-a',
  actorId: 'operator-1',
  bookingId: '11111111-1111-4111-8111-111111111111',
  propertyId: 'property-a',
};

describe('guest intake and check-in release protected APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValue({ session } as never);
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValue({ session } as never);
    vi.mocked(access.requireBookingOpsApiAccess).mockResolvedValue(canonical);
    vi.mocked(flow.getGuestIntakeReleaseSnapshot).mockResolvedValue({} as never);
  });

  it.each([
    ['guest intake GET', () => intakeGet(new Request('http://localhost/api/dashboard/booking-ops/guest-intake-release?bookingId=x'))],
    ['check-in release GET', () => releaseGet(new Request('http://localhost/api/dashboard/booking-ops/checkin-release?bookingId=x'))],
  ])('returns 401 for unauthorized %s', async (_name, call) => {
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValueOnce({ error: unauthorized() } as never);
    expect((await call()).status).toBe(401);
  });

  it.each([
    ['guest intake POST', () => intakePost(new Request('http://localhost/api/dashboard/booking-ops/guest-intake-release', { method: 'POST' }))],
    ['check-in release POST', () => releasePost(new Request('http://localhost/api/dashboard/booking-ops/checkin-release', { method: 'POST' }))],
  ])('returns 401 for unauthorized %s', async (_name, call) => {
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValueOnce({ error: unauthorized() } as never);
    expect((await call()).status).toBe(401);
  });

  it.each([
    ['guest intake', () => intakeGet(new Request('http://localhost/api/dashboard/booking-ops/guest-intake-release?bookingId=request-booking'))],
    ['check-in release', () => releaseGet(new Request('http://localhost/api/dashboard/booking-ops/checkin-release?bookingId=request-booking'))],
  ])('binds %s reads to canonical booking/account/property scope', async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(flow.getGuestIntakeReleaseSnapshot).toHaveBeenCalledWith(
      canonical.bookingId,
      { accountId: canonical.accountId, propertyId: canonical.propertyId },
    );
  });

  it('passes canonical scope through guest-intake draft mutation and post-read', async () => {
    const response = await intakePost(new Request('http://localhost/api/dashboard/booking-ops/guest-intake-release', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'request-booking', action: 'prepare_initial_draft' }),
    }));

    expect(response.status).toBe(200);
    const expectedScope = { accountId: canonical.accountId, propertyId: canonical.propertyId };
    expect(flow.prepareGuestIntakeDraft).toHaveBeenCalledWith(canonical.bookingId, 'initial', expectedScope);
    expect(flow.getGuestIntakeReleaseSnapshot).toHaveBeenLastCalledWith(canonical.bookingId, expectedScope);
  });

  it('passes canonical scope through simulated release and lifecycle side effect', async () => {
    const response = await releasePost(new Request('http://localhost/api/dashboard/booking-ops/checkin-release', {
      method: 'POST',
      body: JSON.stringify({
        bookingId: 'request-booking',
        action: 'simulate_release',
        confirmSimulatedRelease: true,
      }),
    }));

    expect(response.status).toBe(200);
    const expectedScope = { accountId: canonical.accountId, propertyId: canonical.propertyId };
    expect(flow.simulateCheckinRelease).toHaveBeenCalledWith(
      canonical.bookingId,
      true,
      session.email,
      expectedScope,
    );
    expect(lifecycle.emitLifecycleForAction).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: canonical.bookingId,
      expectedScope,
    }));
    expect(flow.getGuestIntakeReleaseSnapshot).toHaveBeenLastCalledWith(canonical.bookingId, expectedScope);
  });
});

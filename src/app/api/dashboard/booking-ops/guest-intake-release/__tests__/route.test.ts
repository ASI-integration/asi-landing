import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import * as auth from '@/lib/crm/api-auth';

vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession: vi.fn(), requireOpsAdminSession: vi.fn() }));
vi.mock('@/lib/booking-ops/guest-intake-checkin-release', () => ({
  ensureGuestIntakeSession: vi.fn(), escalateGuestIntake: vi.fn(), getGuestIntakeReleaseSnapshot: vi.fn(),
  prepareGuestIntakeDraft: vi.fn(), submitGuestIntakeSimulated: vi.fn(), prepareCheckinReleaseDraft: vi.fn(),
  simulateCheckinRelease: vi.fn(),
}));

import { GET as intakeGet, POST as intakePost } from '../route';
import { GET as releaseGet, POST as releasePost } from '../../checkin-release/route';

const unauthorized = () => NextResponse.json({ ok: false }, { status: 401 });

describe('guest intake and check-in release protected APIs', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['guest intake GET', () => intakeGet(new Request('http://localhost/api/dashboard/booking-ops/guest-intake-release?bookingId=x'))],
    ['check-in release GET', () => releaseGet(new Request('http://localhost/api/dashboard/booking-ops/checkin-release?bookingId=x'))],
  ])('returns 401 for unauthorized %s', async (_name, call) => {
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValue({ error: unauthorized() });
    expect((await call()).status).toBe(401);
  });

  it.each([
    ['guest intake POST', () => intakePost(new Request('http://localhost/api/dashboard/booking-ops/guest-intake-release', { method: 'POST' }))],
    ['check-in release POST', () => releasePost(new Request('http://localhost/api/dashboard/booking-ops/checkin-release', { method: 'POST' }))],
  ])('returns 401 for unauthorized %s', async (_name, call) => {
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValue({ error: unauthorized() });
    expect((await call()).status).toBe(401);
  });
});

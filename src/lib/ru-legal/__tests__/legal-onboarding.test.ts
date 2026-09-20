import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const fixture = vi.hoisted(() => ({
  session: { userId: 'owner-1', email: 'owner@example.test' },
  rows: {} as Record<string, Array<Record<string, any>>>,
  inserted: [] as Array<{ table: string; value: Record<string, any> }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/cabinet/api-auth', () => ({
  requireCabinetSession: async () => fixture.session.userId
    ? { session: fixture.session }
    : { error: NextResponse.json({ ok: false }, { status: 401 }) },
}));
vi.mock('@/lib/rental-connect/service', () => ({
  ConnectionValidationError: class extends Error {},
  readConnection: vi.fn(async () => ({ draft: {}, readiness: null, pilotStatus: null })),
  saveConnection: vi.fn(async () => ({ draft: { step: 1 }, readiness: null, pilotStatus: null })),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      let action: 'select' | 'insert' = 'select';
      let insertValue: Record<string, any> | null = null;
      const filters: Array<(row: Record<string, any>) => boolean> = [];
      let limitValue: number | null = null;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        order: () => query,
        limit: (value: number) => { limitValue = value; return query; },
        insert: (value: Record<string, any>) => {
          action = 'insert';
          insertValue = value;
          return query;
        },
        maybeSingle: async () => execute(true),
        single: async () => execute(true),
        then: (resolvePromise: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(execute(false)).then(resolvePromise, reject),
      };
      function execute(single: boolean) {
        const rows = fixture.rows[table] ??= [];
        if (action === 'insert' && insertValue) {
          const row = {
            id: `${table}-${rows.length + 1}`,
            accepted_at: '2026-09-20T20:30:00.000Z',
            ...insertValue,
          };
          rows.push(row);
          fixture.inserted.push({ table, value: insertValue });
          return { data: single ? row : [row], error: null };
        }
        let selected = rows.filter((row) => filters.every((filter) => filter(row)));
        if (limitValue != null) selected = selected.slice(0, limitValue);
        return { data: single ? selected[0] ?? null : selected, error: null };
      }
      return query;
    },
  },
}));

import { POST as acceptLegal } from '@/app/api/ru/legal/acceptances/route';
import { POST as saveConnection } from '@/app/api/cabinet/connect/route';
import {
  RU_LEGAL_DOCUMENTS,
  RU_OFFER_VERSION,
  RU_PD_CONSENT_VERSION,
  acceptCurrentRuLegalDocument,
  getActiveRuAccountSpecialOffer,
  getRuLegalOnboardingStateForUser,
  hasCurrentRuLegalAcceptance,
  isRuLegalAcceptancePersistenceEnabled,
  ruLegalDocumentSha256,
} from '@/lib/ru-legal';
import {
  applyBeginSetup,
  applyCompletePilot,
  applyDeriveReady,
  applyStartPilot,
  createApplicationState,
} from '@/lib/ru-commercial-pilot/lifecycle';

const request = (body: unknown) => new Request('http://localhost/api/test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'legal-test' },
  body: JSON.stringify(body),
});

function acceptance(type: 'offer' | 'personal_data_consent', version: string) {
  return {
    id: `${type}-${version}`,
    account_id: 'account-1',
    accepted_by_user_id: 'owner-1',
    document_type: type,
    document_version: version,
    document_sha256: 'a'.repeat(64),
    accepted_at: '2026-09-20T20:30:00.000Z',
  };
}

beforeEach(() => {
  fixture.rows = {
    account_members: [{ account_id: 'account-1', user_id: 'owner-1', role: 'owner', created_at: '2026-01-01' }],
    ru_legal_acceptances: [],
    ru_account_special_offers: [],
  };
  fixture.inserted = [];
  Object.assign(fixture.session, { userId: 'owner-1', email: 'owner@example.test' });
  vi.stubEnv('RU_LEGAL_ACCEPTANCE_PERSISTENCE_ENABLED', 'true');
});

describe('RU legal onboarding contract', () => {
  it('uses current, distinct canonical versions and stable SHA-256 evidence', () => {
    expect(RU_OFFER_VERSION).toBe('1.0');
    expect(RU_PD_CONSENT_VERSION).toBe('1.0');
    const offerHash = ruLegalDocumentSha256(RU_LEGAL_DOCUMENTS.offer);
    const consentHash = ruLegalDocumentSha256(RU_LEGAL_DOCUMENTS.personal_data_consent);
    expect(offerHash).toMatch(/^[0-9a-f]{64}$/);
    expect(consentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(offerHash).not.toBe(consentHash);
    expect(ruLegalDocumentSha256(RU_LEGAL_DOCUMENTS.offer)).toBe(offerHash);
  });

  it('fails closed unless the localization review gate is explicitly enabled', () => {
    expect(isRuLegalAcceptancePersistenceEnabled({})).toBe(false);
    expect(isRuLegalAcceptancePersistenceEnabled({ RU_LEGAL_ACCEPTANCE_PERSISTENCE_ENABLED: 'false' })).toBe(false);
    expect(isRuLegalAcceptancePersistenceEnabled({ RU_LEGAL_ACCEPTANCE_PERSISTENCE_ENABLED: 'true' })).toBe(true);
  });

  it('accepts only server-owned legal evidence and does not touch pilot or billing state', async () => {
    const accepted = await acceptCurrentRuLegalDocument({
      userId: 'owner-1', email: 'OWNER@example.test', documentType: 'offer', ipAddress: '127.0.0.1', userAgent: 'test',
    });
    expect(accepted.documentVersion).toBe('1.0');
    const insert = fixture.inserted[0];
    expect(insert.table).toBe('ru_legal_acceptances');
    expect(insert.value).toMatchObject({
      account_id: 'account-1',
      accepted_by_user_id: 'owner-1',
      document_type: 'offer',
      document_version: '1.0',
      email_snapshot: 'owner@example.test',
    });
    expect(insert.value.document_sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const forbidden of ['accepted_at', 'pilot_started_at', 'pilot_ends_at', 'subscription_status', 'payment_method_id']) {
      expect(insert.value).not.toHaveProperty(forbidden);
    }
  });

  it('rejects client attempts to forge legal evidence fields', async () => {
    const response = await acceptLegal(request({
      documentType: 'offer', accountId: 'foreign', acceptedAt: '2000-01-01', documentVersion: '9.9', documentSha256: 'fake',
    }));
    expect(response.status).toBe(400);
    expect(fixture.rows.ru_legal_acceptances).toHaveLength(0);
  });

  it('allows only the account owner to accept account-level documents', async () => {
    fixture.rows.account_members[0].role = 'manager';
    const response = await acceptLegal(request({ documentType: 'offer' }));
    expect(response.status).toBe(403);
    expect(fixture.rows.ru_legal_acceptances).toHaveLength(0);
  });

  it('requires both current documents and treats one acceptance as insufficient', async () => {
    fixture.rows.ru_legal_acceptances.push(acceptance('offer', '1.0'));
    expect((await getRuLegalOnboardingStateForUser('owner-1'))?.complete).toBe(false);
    expect(await hasCurrentRuLegalAcceptance('account-1')).toBe(false);
    const response = await saveConnection(request({ step: 0, values: { manager: 'bnovo', otherManager: '' } }));
    expect(response.status).toBe(428);
    expect((await response.json()).code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
  });

  it('requires reacceptance when only old document versions exist', async () => {
    fixture.rows.ru_legal_acceptances.push(
      acceptance('offer', '0.9'),
      acceptance('personal_data_consent', '0.9'),
    );
    const state = await getRuLegalOnboardingStateForUser('owner-1');
    expect(state?.accepted).toEqual({});
    expect(state?.complete).toBe(false);
  });

  it('does not repeatedly block or duplicate a fully accepted current account', async () => {
    fixture.rows.ru_legal_acceptances.push(
      acceptance('offer', '1.0'),
      acceptance('personal_data_consent', '1.0'),
    );
    expect(await hasCurrentRuLegalAcceptance('account-1')).toBe(true);
    expect((await saveConnection(request({ step: 0, values: { manager: 'bnovo', otherManager: '' } }))).status).toBe(200);
    await acceptCurrentRuLegalDocument({ userId: 'owner-1', email: 'owner@example.test', documentType: 'offer' });
    expect(fixture.inserted).toHaveLength(0);
  });

  it('shows a special offer only when it is explicitly assigned, enabled and current', async () => {
    fixture.rows.ru_account_special_offers.push({
      account_id: 'account-1', offer_code: 'community_preliminary', monthly_price_rub: 1000,
      enabled: false, starts_at: null, ends_at: null, created_at: '2026-01-01',
    });
    expect(await getActiveRuAccountSpecialOffer('account-1')).toBeNull();
    fixture.rows.ru_account_special_offers[0].enabled = true;
    expect(await getActiveRuAccountSpecialOffer('account-1')).toMatchObject({ monthly_price_rub: 1000 });
  });

  it('never infers an active RU pilot from the account subscription default', () => {
    const account = { subscription_status: 'trial', trial_started_at: null, trial_ends_at: null };
    const state = createApplicationState('account-1', 'property-1');
    expect(account.subscription_status).toBe('trial');
    expect(state.status).toBe('application');
    expect(state.timestamps.pilotStartedAt).toBeNull();
    expect(applyStartPilot(state, true, new Date('2026-01-01T00:00:00Z'))).toMatchObject({
      ok: false,
      reason: 'cannot_start_pilot_before_ready',
    });
  });

  it('keeps setup open-ended and starts exactly 14 calendar days only after readiness', () => {
    const application = createApplicationState('account-1', 'property-1');
    const setup = applyBeginSetup(application, new Date('2026-01-01T00:00:00Z'));
    expect(setup).toMatchObject({ ok: true, state: { status: 'setup' } });
    if (!setup.ok) throw new Error('setup failed');
    expect(applyStartPilot(setup.state, true, new Date('2026-01-08T00:00:00Z'))).toMatchObject({ ok: false });
    const ready = applyDeriveReady(setup.state, true, new Date('2026-02-01T10:15:00Z'));
    if (!ready.ok) throw new Error('ready failed');
    const active = applyStartPilot(ready.state, true, new Date('2026-02-01T10:15:00Z'));
    if (!active.ok) throw new Error('pilot failed');
    expect(active.state.timestamps.pilotStartedAt?.toISOString()).toBe('2026-02-01T10:15:00.000Z');
    expect(active.state.timestamps.pilotEndsAt?.toISOString()).toBe('2026-02-15T10:15:00.000Z');
  });

  it('completes without automatic paid continuation', () => {
    const application = createApplicationState('account-1', 'property-1');
    const setup = applyBeginSetup(application, new Date('2026-01-01T00:00:00Z'));
    if (!setup.ok) throw new Error('setup failed');
    const ready = applyDeriveReady(setup.state, true, new Date('2026-01-02T00:00:00Z'));
    if (!ready.ok) throw new Error('ready failed');
    const active = applyStartPilot(ready.state, true, new Date('2026-01-02T00:00:00Z'));
    if (!active.ok) throw new Error('active failed');
    const completed = applyCompletePilot(active.state, new Date('2026-01-16T00:00:00Z'));
    expect(completed).toMatchObject({ ok: true, state: { status: 'pilot_completed' } });
  });

  it('keeps public RU copy free of provisional global promises and uses correct brand terminology', () => {
    const publicFiles = [
      'src/app/ru/page.tsx', 'src/app/ru/layout.tsx', 'src/app/ru/how-it-works/page.tsx',
      'src/app/ru/early-access/page.tsx', 'src/app/ru/payment/page.tsx',
      'src/app/ru/otchet-po-dohodnosti-obektov/page.tsx',
      'src/components/dashboard/RentalConnectionFlow.tsx', 'src/components/early-access/EarlyAccessObjectForm.tsx',
      'src/config/ruHomeMetadata.ts',
    ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');
    expect(publicFiles).not.toMatch(/12 месяцев|1\s*000|Стригунова/i);
    const footer = readFileSync(resolve(process.cwd(), 'src/components/ru/RuComplianceFooter.tsx'), 'utf8');
    const compliance = readFileSync(resolve(process.cwd(), 'src/config/ruCompliance.ts'), 'utf8');
    expect(footer).toContain('ruCompliance.fullName');
    expect(compliance).toContain('Реутова Юлия Игоревна');
    expect(footer).toContain('Самозанятая · ИНН');
    expect(footer).toContain('Shiro — официальный маскот ASI Global');
    expect(footer).not.toMatch(/Shiro[^\n]*(логотип|подпись)/i);
  });
});

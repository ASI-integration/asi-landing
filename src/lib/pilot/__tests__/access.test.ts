import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPilotBetaEmail,
  pilotBetaAllowlist,
  resolvePilotBetaRole,
  PILOT_BETA_ROLE,
} from '../access';
import { createPilotConversationId } from '../ids';
import { isDevelopmentOwnerEmail } from '@/lib/development/access';

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SP-02 pilot invite allowlist', () => {
  it('grants pilot_beta only to ASI_PILOT_BETA_EMAILS (case-insensitive)', () => {
    vi.stubEnv('ASI_PILOT_BETA_EMAILS', 'Strigunov@Example.com, other@pilot.test');
    expect(isPilotBetaEmail('strigunov@example.com')).toBe(true);
    expect(isPilotBetaEmail('OTHER@PILOT.TEST')).toBe(true);
    expect(resolvePilotBetaRole('strigunov@example.com')).toBe(PILOT_BETA_ROLE);
  });

  it('denies unknown / uninvited emails (no pilot_beta)', () => {
    vi.stubEnv('ASI_PILOT_BETA_EMAILS', 'strigunov@example.com');
    expect(isPilotBetaEmail('user@example.com')).toBe(false);
    expect(resolvePilotBetaRole('user@example.com')).toBeNull();
  });

  it('denies everyone when ASI_PILOT_BETA_EMAILS is empty', () => {
    vi.stubEnv('ASI_PILOT_BETA_EMAILS', '');
    expect(pilotBetaAllowlist().size).toBe(0);
    expect(isPilotBetaEmail('strigunov@example.com')).toBe(false);
  });

  it('does not treat development owners or CRM operators as pilot_beta without pilot invite', () => {
    vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', 'owner@example.com');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'crm@asi-global.ru');
    vi.stubEnv('ASI_PILOT_BETA_EMAILS', 'strigunov@example.com');
    expect(isPilotBetaEmail('owner@example.com')).toBe(false);
    expect(isPilotBetaEmail('crm@asi-global.ru')).toBe(false);
    expect(isDevelopmentOwnerEmail('owner@example.com')).toBe(true);
    expect(isDevelopmentOwnerEmail('strigunov@example.com')).toBe(false);
  });

  it('keeps owner allowlist behavior unchanged when pilot env is set', () => {
    vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', 'owner@example.com');
    vi.stubEnv('ASI_PILOT_BETA_EMAILS', 'strigunov@example.com');
    expect(isDevelopmentOwnerEmail('owner@example.com')).toBe(true);
    expect(isDevelopmentOwnerEmail('strigunov@example.com')).toBe(false);
  });
});

describe('SP-02 pilot conversation namespace', () => {
  it('isolates pilot conversation ids from owner console ids and across users', async () => {
    const { createDevelopmentConversationId } = await import('@/lib/development/ids');
    const userA = 'user-a';
    const userB = 'user-b';
    const pilotA = createPilotConversationId(userA);
    const pilotB = createPilotConversationId(userB);
    const ownerA = createDevelopmentConversationId(userA);
    expect(pilotA).toMatch(/^pilot-beta-[a-f0-9]{24}$/);
    expect(pilotA).not.toBe(pilotB);
    expect(pilotA).not.toBe(ownerA);
  });
});

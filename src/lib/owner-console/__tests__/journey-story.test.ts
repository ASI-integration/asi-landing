import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chooseRefundPath, storyScenes } from '@/lib/owner-console/journey-story';
import { storyEvidence } from '@/lib/owner-console/journey-evidence';

describe('public hospitality guest journey', () => {
  it('is bilingual, ordered and covers the real guest lifecycle without inventing production data', () => {
    const expected = [
      'reservation', 'communication', 'change', 'refund', 'incident',
      'housekeeping', 'resale', 'lost-property', 'corporate',
    ];
    for (const language of ['ru', 'en'] as const) {
      const scenes = storyScenes(language);
      expect(scenes.map((stage) => stage.id)).toEqual(expected);
      for (const scene of scenes) {
        expect(scene.heading.length).toBeGreaterThan(10);
        expect(scene.policy.length).toBeGreaterThan(20);
        expect(scene.artifact).toBeTruthy();
        expect(scene.view.guest.length).toBeGreaterThan(0);
        expect(scene.view.manager.length).toBeGreaterThan(0);
        expect(scene.view.owner.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps refund decisions within the explicitly delegated three-night limit', () => {
    expect(chooseRefundPath(1)).toBe('delegated');
    expect(chooseRefundPath(3)).toBe('delegated');
    expect(chooseRefundPath(4)).toBe('approval');
    expect(chooseRefundPath(10)).toBe('approval');
    expect(chooseRefundPath(0)).toBe('approval');
    expect(chooseRefundPath(-1)).toBe('approval');
    expect(chooseRefundPath(Number.NaN)).toBe('approval');
    expect(chooseRefundPath(1.5)).toBe('approval');
    expect(chooseRefundPath(2, 1)).toBe('approval');
  });

  it('marks fires, payment, messenger, voice and courier operations as simulated and guarded', () => {
    const ru = storyScenes('ru');
    const incident = ru.find((stage) => stage.id === 'incident')!;
    expect(incident.policy).toContain('уполномоченным человеком');
    const lost = ru.find((stage) => stage.id === 'lost-property')!;
    expect(lost.policy).toContain('согласия');
    const booking = ru.find((stage) => stage.id === 'reservation')!;
    expect(booking.policy).toContain('PMS/OTA');
    const resale = ru.find((stage) => stage.id === 'resale')!;
    expect(resale.policy).toContain('Нельзя открывать календарь');
    const corporate = ru.find((stage) => stage.id === 'corporate')!;
    expect(corporate.policy).toContain('HR');
    const voice = storyScenes('en').find((stage) => stage.id === 'communication')!;
    expect(voice.policy).toContain('not completed real calls');
  });

  it('shows inspectable synthetic calendars, incidents, staffing and delegated refund status', () => {
    expect(storyEvidence('ru', 'reservation').items[0].value).toBe('DEMO-2148');
    expect(storyEvidence('ru', 'incident').items[0].value).toContain('Дым');
    expect(storyEvidence('ru', 'housekeeping').items[0].value).toContain('подтверждения');
    expect(storyEvidence('en', 'resale').items[3].value).toBe('DEMO-2149');
    expect(storyEvidence('ru', 'refund', 3).items[2].value).toBe('В рамках полномочий');
    expect(storyEvidence('ru', 'refund', 4).items[2].value).toBe('Согласование владельца');
    expect(storyEvidence('en', 'refund', 4).items[2].value).toBe('Owner approval required');
  });

  it('preserves the proven technical demo underneath the new human-readable story', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/owner/OwnerConsole.tsx'), 'utf8');
    expect(source).toContain('<GuestJourneyDemo lang={context.lang} />');
    expect(source).toContain('{copy.technicalDemoLabel}');
    expect(source).toContain("fetch('/api/owner/demo'");
    const ui = readFileSync(join(process.cwd(), 'src/app/owner/GuestJourneyDemo.tsx'), 'utf8');
    expect(ui).toContain('data-testid="guest-journey-demo"');
    expect(ui).toContain('0 real messages');
    expect(ui).toContain('0 payments');
    expect(ui).toContain('0 платежей');
    expect(ui).not.toContain("fetch(");
  });

  it('opens the existing Russian email sign-in directly without a new identity provider', () => {
    const owner = readFileSync(join(process.cwd(), 'src/app/owner/OwnerConsole.tsx'), 'utf8');
    const onboarding = readFileSync(join(process.cwd(), 'src/components/OnboardingPageContent.tsx'), 'utf8');
    expect(owner).toContain('/ru/connect?mode=login&redirect=%2Fru%2Flegal-onboarding#connect-email');
    expect(onboarding).toContain("searchParams.get('mode') === 'login'");
    expect(onboarding).toContain('id="connect-email"');
    expect(onboarding).toContain("'/api/auth/login'");
    const ruHeader = readFileSync(join(process.cwd(), 'src/components/ru/RuPublicNavHeader.tsx'), 'utf8');
    expect(ruHeader).toContain("const RU_EMAIL_LOGIN_HREF = '/ru/connect?mode=login");
    expect(ruHeader).toContain('Войти по email');
    expect(ruHeader).toContain('href={RU_EMAIL_LOGIN_HREF}');
  });
});

import { describe, expect, it } from 'vitest';
import {
  isExplicitEmergencyTestProbe,
  resolveTelegramEmergencyProtocol,
} from '../telegram-emergency-protocol';

describe('telegram emergency protocol v0', () => {
  it('classifies fire as critical and recommends 112 or 101', () => {
    const decision = resolveTelegramEmergencyProtocol('В квартире пожар, сильный дым');

    expect(decision).toMatchObject({
      kind: 'fire',
      severity: 'critical',
      isExplicitTestProbe: false,
    });
    expect(decision?.replyText).toContain('112');
    expect(decision?.replyText).toContain('101');
    expect(decision?.replyText).not.toContain('вызвала');
  });

  it('classifies gas as critical and does not claim services were called', () => {
    const decision = resolveTelegramEmergencyProtocol('Пахнет газом на кухне');

    expect(decision?.kind).toBe('gas');
    expect(decision?.severity).toBe('critical');
    expect(decision?.replyText).toContain('112');
    expect(decision?.replyText).not.toContain('вызвала');
  });

  it('classifies medical distress with 112 or 103 guidance', () => {
    const decision = resolveTelegramEmergencyProtocol('Человеку плохо, нужна скорая');

    expect(decision?.kind).toBe('medical');
    expect(decision?.severity).toBe('critical');
    expect(decision?.replyText).toContain('112');
    expect(decision?.replyText).toContain('103');
  });

  it('keeps flood as high severity unless life threat is explicit', () => {
    const decision = resolveTelegramEmergencyProtocol('Нас затопило, вода в ванной');

    expect(decision?.kind).toBe('flood');
    expect(decision?.severity).toBe('high');
  });

  it('detects explicit emergency test probes', () => {
    expect(isExplicitEmergencyTestProbe('/emergency_test пожар')).toBe(true);
    expect(resolveTelegramEmergencyProtocol('тест пожар')?.isExplicitTestProbe).toBe(true);
  });
});

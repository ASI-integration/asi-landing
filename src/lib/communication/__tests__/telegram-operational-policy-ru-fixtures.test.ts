import { describe, expect, it } from 'vitest';
import { executeTelegramOperationalPolicy } from '../telegram-operational-policy-executor';
import { TELEGRAM_OPERATIONAL_POLICY_RU_FIXTURES } from './fixtures/telegram-operational-policy-ru.fixtures';

describe('executeTelegramOperationalPolicy RU fixtures', () => {
  it('covers broad operational scenario families with deterministic matching', () => {
    expect(TELEGRAM_OPERATIONAL_POLICY_RU_FIXTURES.length).toBeGreaterThanOrEqual(40);

    for (const fixture of TELEGRAM_OPERATIONAL_POLICY_RU_FIXTURES) {
      const result = executeTelegramOperationalPolicy({
        messageText: fixture.text,
        knownContext: fixture.knownContext ?? { objectLabel: 'Невский 24' },
      });
      expect(result.scenarioFamily, fixture.text).toBe(fixture.expectedScenario);
      if (fixture.expectedAction) {
        expect(result.action, fixture.text).toBe(fixture.expectedAction);
      }
    }
  });
});

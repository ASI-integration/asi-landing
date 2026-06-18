import type { ObjectGuestReadiness } from './object-guest-readiness';
import { getAsiFeedbackBotUsername } from '@/config/publicTelegram';

export type SetupNextStepPhase =
  | 'filling'
  | 'launch_guest_test'
  | 'guest_test_started';

export type SetupNextStepCtaKind = 'setup_step' | 'external' | 'launch_guest_test';

export type SetupNextStepCta = {
  kind: SetupNextStepCtaKind;
  label: string;
  href: string | null;
  setupStep: string | null;
};

export type SetupNextStepModel = {
  phase: SetupNextStepPhase;
  statusMessage: string;
  primaryCta: SetupNextStepCta;
  secondaryCta: SetupNextStepCta | null;
  showTelegramFallback: boolean;
  guestTestCommand: string | null;
  hidePilotTelegramCta: boolean;
  hidePilotPrimaryCta: boolean;
};

export function buildTelegramBotUrl(): string {
  return `https://t.me/${getAsiFeedbackBotUsername()}`;
}

export function resolveSetupNextStep(input: {
  readiness: ObjectGuestReadiness;
  telegramLinked: boolean;
  guestTestDispatched: boolean;
  onSetupPage?: boolean;
}): SetupNextStepModel {
  const onSetupPage = Boolean(input.onSetupPage);
  const { readiness } = input;

  if (!readiness.isReady) {
    const next = readiness.nextItem;
    return {
      phase: 'filling',
      statusMessage: readiness.statusMessage,
      primaryCta: {
        kind: 'setup_step',
        label: next ? `Заполнить: ${next.label}` : 'Продолжить заполнение',
        href: next?.actionHref ?? null,
        setupStep: next?.setupStep ?? 'basic',
      },
      secondaryCta: null,
      showTelegramFallback: false,
      guestTestCommand: null,
      hidePilotTelegramCta: onSetupPage,
      hidePilotPrimaryCta: onSetupPage,
    };
  }

  if (input.guestTestDispatched) {
    return {
      phase: 'guest_test_started',
      statusMessage: 'Тест гостя запущен. Откройте Telegram и задайте вопрос по объекту.',
      primaryCta: {
        kind: 'external',
        label: 'Открыть Telegram',
        href: buildTelegramBotUrl(),
        setupStep: null,
      },
      secondaryCta: {
        kind: 'launch_guest_test',
        label: 'Перезапустить тест гостя в Telegram',
        href: null,
        setupStep: null,
      },
      showTelegramFallback: true,
      guestTestCommand: readiness.guestTestCommand,
      hidePilotTelegramCta: true,
      hidePilotPrimaryCta: onSetupPage,
    };
  }

  return {
    phase: 'launch_guest_test',
    statusMessage: 'Объект готов. Запустите тест гостя в Telegram.',
    primaryCta: {
      kind: 'launch_guest_test',
      label: 'Запустить тест гостя в Telegram',
      href: null,
      setupStep: null,
    },
    secondaryCta: null,
    showTelegramFallback: true,
    guestTestCommand: readiness.guestTestCommand,
    hidePilotTelegramCta: true,
    hidePilotPrimaryCta: onSetupPage,
  };
}

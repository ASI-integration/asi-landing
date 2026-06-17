import type { ObjectGuestReadiness } from './object-guest-readiness';
import { getAsiFeedbackBotUsername } from '@/config/publicTelegram';

export type SetupNextStepPhase =
  | 'filling'
  | 'connect_telegram'
  | 'telegram_sent'
  | 'check_result';

export type SetupNextStepCtaKind = 'setup_step' | 'external';

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
      showTelegramFallback: false,
      guestTestCommand: null,
      hidePilotTelegramCta: onSetupPage,
      hidePilotPrimaryCta: onSetupPage,
    };
  }

  if (input.guestTestDispatched) {
    return {
      phase: input.telegramLinked ? 'telegram_sent' : 'check_result',
      statusMessage: 'Объект готов. Тест гостя отправлен в Telegram.',
      primaryCta: {
        kind: 'external',
        label: 'Открыть Telegram',
        href: buildTelegramBotUrl(),
        setupStep: null,
      },
      showTelegramFallback: true,
      guestTestCommand: readiness.guestTestCommand,
      hidePilotTelegramCta: true,
      hidePilotPrimaryCta: onSetupPage,
    };
  }

  return {
    phase: 'connect_telegram',
    statusMessage: 'Объект готов. Подключите Telegram, чтобы запустить тест гостя.',
    primaryCta: {
      kind: 'external',
      label: 'Подключить Telegram и запустить тест',
      href: readiness.guestTestDeepLink,
      setupStep: null,
    },
    showTelegramFallback: true,
    guestTestCommand: readiness.guestTestCommand,
    hidePilotTelegramCta: true,
    hidePilotPrimaryCta: onSetupPage,
  };
}

'use client';

import Link from 'next/link';
import {
  buildPilotTelegramContinuation,
  computeDashboardPilotProgress,
  resolveDashboardPilotNextAction,
  type DashboardPilotProgress,
} from '@/lib/crm/pilot-onboarding';
import { PilotOnboardingProgress } from '@/components/PilotOnboardingProgress';
import { TgIcon } from '@/components/TgIcon';

type PilotDashboardOnboardingBlockProps = {
  crmContactId: string | null;
  properties: Array<{
    id: string;
    city?: string | null;
    address?: string | null;
    guestReadinessReady?: boolean;
  }>;
  propertyId?: string;
  context?: 'list' | 'detail' | 'setup';
  guestTestDispatched?: boolean;
  telegramLinked?: boolean;
};

const SUBTITLE_BY_CONTEXT: Record<NonNullable<PilotDashboardOnboardingBlockProps['context']>, string> = {
  list: 'Вы уже в кабинете. Следующий шаг — создать объект и заполнить данные.',
  detail: 'Объект создан. Заполните данные для теста гостя.',
  setup: 'Заполните данные объекта — ASI подскажет один следующий шаг.',
};

export function buildPilotDashboardOnboardingModel(
  input: PilotDashboardOnboardingBlockProps,
): {
  progress: DashboardPilotProgress;
  telegramHref: string;
  telegramHint: string | null;
  nextAction: ReturnType<typeof resolveDashboardPilotNextAction>;
  showTelegramContinuation: boolean;
  showPrimaryAction: boolean;
  showGuestTestAction: boolean;
} | null {
  const context = input.context ?? 'list';
  const progress = computeDashboardPilotProgress({
    crmContactId: input.crmContactId,
    properties: input.properties,
    propertyId: input.propertyId,
    guestTestStarted: input.guestTestDispatched,
  });
  if (!progress) return null;

  const targetProperty =
    (input.propertyId ? input.properties.find((item) => item.id === input.propertyId) : null) ??
    input.properties[0];
  const guestReady = Boolean(targetProperty?.guestReadinessReady);

  const { href: telegramHref, hint: telegramHint } = buildPilotTelegramContinuation(input.crmContactId);
  const nextAction = resolveDashboardPilotNextAction(input.properties, {
    propertyId: input.propertyId,
    onSetupPage: context === 'setup',
  });

  const onSetupPage = context === 'setup';

  return {
    progress,
    telegramHref,
    telegramHint,
    nextAction,
    showTelegramContinuation: !onSetupPage && !guestReady,
    showPrimaryAction: !onSetupPage && !guestReady && Boolean(nextAction.label),
    showGuestTestAction: !onSetupPage && guestReady && !input.guestTestDispatched,
  };
}

export function PilotDashboardOnboardingBlock({
  crmContactId,
  properties,
  propertyId,
  context = 'list',
  guestTestDispatched = false,
  telegramLinked = false,
}: PilotDashboardOnboardingBlockProps) {
  const model = buildPilotDashboardOnboardingModel({
    crmContactId,
    properties,
    propertyId,
    context,
    guestTestDispatched,
    telegramLinked,
  });
  if (!model) return null;

  const { progress, telegramHref, telegramHint, nextAction, showTelegramContinuation, showPrimaryAction, showGuestTestAction } =
    model;

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
      <h2 className="text-lg font-semibold text-emerald-950">Продолжите подключение к пилоту ASI</h2>
      <p className="mt-1 text-sm text-emerald-900">{SUBTITLE_BY_CONTEXT[context]}</p>

      <div className="mt-4 rounded-lg border border-emerald-200 bg-white/80 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Маршрут пилота</p>
        <div className="mt-2">
          <PilotOnboardingProgress progress={progress} />
        </div>
      </div>

      {showPrimaryAction || showTelegramContinuation || showGuestTestAction ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {showPrimaryAction && nextAction.label ? (
            nextAction.href ? (
              <Link
                href={nextAction.href}
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {nextAction.label}
              </Link>
            ) : (
              <a
                href="#create-property"
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {nextAction.label}
              </a>
            )
          ) : null}
          {showTelegramContinuation ? (
            <a
              href={telegramHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Продолжить в Telegram"
              className="inline-flex items-center justify-center gap-3 rounded-lg border border-[#2CA5E0]/40 bg-white px-5 py-3 text-sm font-semibold text-emerald-950 shadow-sm hover:border-[#2CA5E0]/70 hover:bg-[#2CA5E0]/5"
            >
              <TgIcon className="h-8 w-8 shrink-0" />
              <span>Продолжить в Telegram</span>
            </a>
          ) : null}
          {showGuestTestAction && nextAction.guestTestDeepLink ? (
            <a
              href={nextAction.guestTestDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <TgIcon className="h-5 w-5 shrink-0" />
              Подключить Telegram и запустить тест
            </a>
          ) : null}
        </div>
      ) : null}
      {telegramHint && showTelegramContinuation ? (
        <p className="mt-3 text-xs text-emerald-800">{telegramHint}</p>
      ) : null}
    </section>
  );
}

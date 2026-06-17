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
  properties: Array<{ id: string; city?: string | null; address?: string | null }>;
  propertyId?: string;
  context?: 'list' | 'detail' | 'setup';
};

const SUBTITLE_BY_CONTEXT: Record<NonNullable<PilotDashboardOnboardingBlockProps['context']>, string> = {
  list: 'Вы уже в кабинете. Следующий шаг — создать объект и продолжить сценарий в Telegram.',
  detail: 'Объект создан. Заполните данные и продолжите сценарий в Telegram.',
  setup: 'Заполните данные объекта и продолжите сценарий в Telegram.',
};

export function buildPilotDashboardOnboardingModel(
  input: PilotDashboardOnboardingBlockProps,
): {
  progress: DashboardPilotProgress;
  telegramHref: string;
  telegramHint: string | null;
  nextAction: ReturnType<typeof resolveDashboardPilotNextAction>;
} | null {
  const context = input.context ?? 'list';
  const progress = computeDashboardPilotProgress({
    crmContactId: input.crmContactId,
    properties: input.properties,
    propertyId: input.propertyId,
  });
  if (!progress) return null;

  const { href: telegramHref, hint: telegramHint } = buildPilotTelegramContinuation(input.crmContactId);
  const nextAction = resolveDashboardPilotNextAction(input.properties, {
    propertyId: input.propertyId,
    onSetupPage: context === 'setup',
  });

  return {
    progress,
    telegramHref,
    telegramHint,
    nextAction,
  };
}

export function PilotDashboardOnboardingBlock({
  crmContactId,
  properties,
  propertyId,
  context = 'list',
}: PilotDashboardOnboardingBlockProps) {
  const model = buildPilotDashboardOnboardingModel({ crmContactId, properties, propertyId, context });
  if (!model) return null;

  const { progress, telegramHref, telegramHint, nextAction } = model;

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

      <div className="mt-4 flex flex-wrap gap-3">
        {nextAction.label ? (
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
      </div>
      {nextAction.guestTestCommand ? (
        <p className="mt-3 text-sm text-emerald-900">
          В Telegram отправьте команду:{' '}
          <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs font-semibold text-emerald-950">
            {nextAction.guestTestCommand}
          </code>
        </p>
      ) : null}
      {telegramHint ? <p className="mt-3 text-xs text-emerald-800">{telegramHint}</p> : null}
    </section>
  );
}

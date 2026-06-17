'use client';

import Link from 'next/link';
import {
  buildPilotTelegramContinuation,
  computeDashboardPilotProgress,
  resolveDashboardPilotNextPropertyHref,
  type DashboardPilotProgress,
} from '@/lib/crm/pilot-onboarding';
import { PilotOnboardingProgress } from '@/components/PilotOnboardingProgress';

type PilotDashboardOnboardingBlockProps = {
  crmContactId: string;
  properties: Array<{ id: string; city?: string | null; address?: string | null }>;
};

export function buildPilotDashboardOnboardingModel(
  input: PilotDashboardOnboardingBlockProps,
): {
  progress: DashboardPilotProgress;
  telegramHref: string;
  telegramHint: string | null;
  createObjectHref: string | null;
} | null {
  const progress = computeDashboardPilotProgress({
    crmContactId: input.crmContactId,
    properties: input.properties,
  });
  if (!progress) return null;

  const { href: telegramHref, hint: telegramHint } = buildPilotTelegramContinuation(input.crmContactId);
  const createObjectHref = resolveDashboardPilotNextPropertyHref(input.properties);

  return {
    progress,
    telegramHref,
    telegramHint,
    createObjectHref,
  };
}

export function PilotDashboardOnboardingBlock({ crmContactId, properties }: PilotDashboardOnboardingBlockProps) {
  const model = buildPilotDashboardOnboardingModel({ crmContactId, properties });
  if (!model) return null;

  const { progress, telegramHref, telegramHint, createObjectHref } = model;

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
      <h2 className="text-lg font-semibold text-emerald-950">Продолжите подключение к пилоту ASI</h2>
      <p className="mt-1 text-sm text-emerald-900">
        Вы уже в кабинете. Следующий шаг — создать объект и продолжить сценарий в Telegram.
      </p>

      <div className="mt-4 rounded-lg border border-emerald-200 bg-white/80 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Маршрут пилота</p>
        <div className="mt-2">
          <PilotOnboardingProgress progress={progress} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {createObjectHref ? (
          <Link
            href={createObjectHref}
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Создать объект
          </Link>
        ) : (
          <a
            href="#create-property"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Создать объект
          </a>
        )}
        <a
          href={telegramHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
        >
          Продолжить в Telegram
        </a>
      </div>
      {telegramHint ? <p className="mt-3 text-xs text-emerald-800">{telegramHint}</p> : null}
    </section>
  );
}

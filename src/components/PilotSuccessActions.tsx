'use client';

import Link from 'next/link';
import {
  buildPilotApplicationTelegramLink,
  buildPilotCabinetConnectHref,
  type PilotOnboardingProgress,
} from '@/lib/crm/pilot-onboarding';
import { PilotOnboardingProgress as PilotOnboardingProgressView } from '@/components/PilotOnboardingProgress';

type PilotSuccessActionsProps = {
  contactId: string;
  progress: PilotOnboardingProgress;
};

export function PilotSuccessActions({ contactId, progress }: PilotSuccessActionsProps) {
  const telegramHref = buildPilotApplicationTelegramLink(contactId);
  const cabinetHref = buildPilotCabinetConnectHref(contactId);

  return (
    <div className="space-y-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-950">
      <div>
        <h2 className="text-base font-semibold text-emerald-900">Заявка принята</h2>
        <p className="mt-1 text-emerald-800">
          Выберите, как удобнее продолжить: через Telegram или сразу в личном кабинете ASI.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href={telegramHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800"
        >
          Продолжить в Telegram
        </a>
        <Link
          href={cabinetHref}
          className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-4 py-3 text-center text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
        >
          Войти в кабинет и создать объект
        </Link>
      </div>

      <div className="rounded-md border border-emerald-200 bg-white/80 px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Прогресс подключения</p>
        <div className="mt-2">
          <PilotOnboardingProgressView progress={progress} />
        </div>
      </div>
    </div>
  );
}

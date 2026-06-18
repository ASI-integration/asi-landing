'use client';

import type { GuestTestFlowState } from '@/lib/crm/guest-test-flow';
import type { ObjectGuestReadiness } from '@/lib/property-setup/object-guest-readiness';
import { resolveSetupNextStep } from '@/lib/property-setup/setup-next-step';
import { GuestTestLaunchCta, GuestTestLaunchFallback } from '@/components/dashboard/GuestTestLaunchCta';

type ObjectGuestReadinessBlockProps = {
  readiness: ObjectGuestReadiness;
  guestTestFlow?: GuestTestFlowState | null;
  onGoToStep: (step: string) => void;
  onGuestTestFlowChange?: (flow: GuestTestFlowState) => void;
  onLaunchMessage?: (message: string | null) => void;
  onLaunchError?: (message: string | null) => void;
  compact?: boolean;
  showPrimaryCta?: boolean;
};

export function ObjectGuestReadinessBlock({
  readiness,
  guestTestFlow = null,
  onGoToStep,
  onGuestTestFlowChange,
  onLaunchMessage,
  onLaunchError,
  compact = false,
  showPrimaryCta = true,
}: ObjectGuestReadinessBlockProps) {
  const { items, completedCount, totalCount, isReady } = readiness;
  const nextStep = resolveSetupNextStep({
    readiness,
    telegramLinked: guestTestFlow?.telegramLinked ?? false,
    guestTestDispatched: guestTestFlow?.guestTestDispatched ?? false,
    onSetupPage: true,
  });

  return (
    <section
      className={`rounded-xl border ${
        isReady ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
      } p-5 shadow-sm`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Готовность к тесту гостя</h2>
          <p className="mt-1 text-sm text-slate-600">{nextStep.statusMessage}</p>
          <p className="mt-2 text-sm font-medium text-slate-700">
            Заполнено {completedCount} из {totalCount}
          </p>
        </div>
        {isReady ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            Готов к тесту
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            Нужны данные
          </span>
        )}
      </div>

      {!compact ? (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {item.done ? '✓' : '—'}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${item.done ? 'text-slate-900' : 'text-slate-600'}`}>
                  {item.label}
                </p>
                {!item.done ? <p className="text-xs text-slate-500">{item.hint}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {showPrimaryCta ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {nextStep.primaryCta.kind === 'setup_step' ? (
            <button
              type="button"
              onClick={() => onGoToStep(nextStep.primaryCta.setupStep ?? 'basic')}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              {nextStep.primaryCta.label}
            </button>
          ) : (
            <GuestTestLaunchCta
              propertyId={readiness.propertyId}
              nextStep={nextStep}
              cta={nextStep.primaryCta}
              onGuestTestFlowChange={onGuestTestFlowChange}
              onLaunchMessage={onLaunchMessage}
              onLaunchError={onLaunchError}
            />
          )}
          {nextStep.secondaryCta ? (
            <GuestTestLaunchCta
              propertyId={readiness.propertyId}
              nextStep={nextStep}
              cta={nextStep.secondaryCta}
              onGuestTestFlowChange={onGuestTestFlowChange}
              onLaunchMessage={onLaunchMessage}
              onLaunchError={onLaunchError}
              variant="secondary"
            />
          ) : null}
        </div>
      ) : null}

      {nextStep.showTelegramFallback && nextStep.guestTestCommand ? (
        <GuestTestLaunchFallback guestTestCommand={nextStep.guestTestCommand} />
      ) : null}
    </section>
  );
}

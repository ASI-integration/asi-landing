import Link from 'next/link';
import type { PropertyReadiness } from '@/lib/channel-manager/property-lifecycle';

const statusTone: Record<PropertyReadiness['status'], string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  info_required: 'bg-amber-50 text-amber-800 border-amber-200',
  photos_required: 'bg-amber-50 text-amber-800 border-amber-200',
  ready_for_mapping: 'bg-sky-50 text-sky-800 border-sky-200',
  channels_pending: 'bg-sky-50 text-sky-800 border-sky-200',
  shadow_mode: 'bg-violet-50 text-violet-800 border-violet-200',
  ready_for_activation: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  active: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  attention_required: 'bg-red-50 text-red-800 border-red-200',
};

export function PropertyPreparationSteps({
  readiness,
  propertyId,
  propertyTitle,
}: {
  readiness: PropertyReadiness;
  propertyId?: string;
  propertyTitle?: string;
}) {
  const hasProperty = Boolean(propertyId);
  const nextStep = readiness.steps.find((step) => !step.done) ?? readiness.steps.at(-1);
  const upcomingSteps = readiness.steps.filter((step) => !step.done).slice(0, 3);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Данные объекта для каналов</h2>
            <p className="mt-1 text-sm text-slate-500">
              Заполните данные один раз — ASI подготовит карточки для каналов и проверит готовность.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-sm font-medium ${statusTone[readiness.status]}`}>
            {readiness.statusLabel}
          </span>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase text-slate-400">Объект</p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                  {propertyTitle || (hasProperty ? 'Выбранный объект' : 'Сначала выберите объект')}
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase text-slate-400">Прогресс</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  Готово: {readiness.completedStepCount} из {readiness.totalStepCount}
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase text-slate-400">Статус</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{readiness.statusLabel}</p>
              </div>
            </div>

            <div>
              <p className="text-sm leading-6 text-slate-600">{readiness.statusMessage}</p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                Следующий шаг: {hasProperty && nextStep ? nextStep.actionLabel ?? nextStep.title : 'Сначала выберите объект'}
              </p>
            </div>

            {upcomingSteps.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {upcomingSteps.map((step, index) => (
                  <li key={step.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {index === 0 ? 'Сейчас' : 'Потом'}: {step.actionLabel ?? step.title}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {hasProperty && nextStep?.actionHref ? (
            <Link
              href={nextStep.actionHref}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Продолжить заполнение
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-500"
            >
              Сначала выберите объект
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

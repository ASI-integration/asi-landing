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

export function PropertyPreparationSteps({ readiness }: { readiness: PropertyReadiness }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Подготовка объекта</h2>
            <p className="mt-1 text-sm text-slate-500">
              Заполните данные один раз — ASI подготовит карточки и подключит каналы.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-sm font-medium ${statusTone[readiness.status]}`}>
            {readiness.statusLabel}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">{readiness.statusMessage}</p>
        <p className="mt-2 text-xs text-slate-500">
          Готово шагов: {readiness.completedStepCount} из {readiness.totalStepCount}
        </p>
      </div>
      <ol className="divide-y divide-slate-100">
        {readiness.steps.map((step, index) => (
          <li key={step.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-3">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {step.done ? '✓' : index + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-slate-900">{step.title}</p>
                <p className="mt-1 text-sm text-slate-500">{step.description}</p>
              </div>
            </div>
            {!step.done && step.actionHref ? (
              <Link
                href={step.actionHref}
                className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {step.actionLabel ?? 'Открыть'}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

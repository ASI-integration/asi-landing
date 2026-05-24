import {
  countOperationsByStatus,
  operationEntityLabels,
  operationEntityOrder,
  operationsFoundationItems,
  operationStatusLabels,
  operationStatusOrder,
} from '@/lib/operations/foundation';
import type { OperationEntityType, OperationFoundationItem, OperationStatus } from '@/lib/operations/types';

const statusTone: Record<OperationStatus, string> = {
  new: 'border-blue-200 bg-blue-50 text-blue-700',
  in_progress: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  waiting: 'border-amber-200 bg-amber-50 text-amber-800',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  escalated: 'border-rose-200 bg-rose-50 text-rose-700',
};

const entityTone: Record<OperationEntityType, string> = {
  booking_intake: 'border-slate-200 bg-white',
  check_in: 'border-blue-100 bg-blue-50/50',
  cleaning: 'border-emerald-100 bg-emerald-50/50',
  maintenance: 'border-amber-100 bg-amber-50/50',
  guest_issue: 'border-indigo-100 bg-indigo-50/50',
  owner_operator_task: 'border-slate-200 bg-slate-50',
};

function StatusBadge({ status }: { status: OperationStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone[status]}`}>
      {operationStatusLabels[status]}
    </span>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function OperationRow({ item }: { item: OperationFoundationItem }) {
  return (
    <div className="grid gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 lg:grid-cols-[1fr_160px_150px_120px]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-1 text-xs font-medium text-slate-700 ${entityTone[item.type]}`}>
            {operationEntityLabels[item.type]}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <h3 className="mt-2 text-sm font-semibold text-slate-900">{item.title}</h3>
        <p className="mt-1 text-sm text-slate-500">{item.propertyLabel}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">Ответственный</p>
        <p className="mt-1 text-sm font-medium text-slate-800">{item.owner}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">Срок</p>
        <p className="mt-1 text-sm font-medium text-slate-800">{item.dueLabel}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">Откуда</p>
        <p className="mt-1 text-sm font-medium text-slate-800">{item.sourceLabel}</p>
      </div>
    </div>
  );
}

export default function OperationsPage() {
  const counts = countOperationsByStatus(operationsFoundationItems);
  const activeCount = operationsFoundationItems.filter((item) => item.status !== 'done').length;
  const escalatedCount = counts.escalated;
  const waitingCount = counts.waiting;

  return (
    <div className="max-w-6xl space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Рабочий раздел</p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Операции</h1>
        <p className="max-w-3xl text-base leading-relaxed text-slate-600">
          Рабочее место для брони, заездов, уборки, ремонта и задач команды. Сейчас это основа без внешних подключений.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Активные задачи" value={activeCount} hint="Всё, что ещё не закрыто" />
        <SummaryCard label="Срочно" value={escalatedCount} hint="Нужна ручная проверка" />
        <SummaryCard label="Ждём" value={waitingCount} hint="Ожидаем фото, ответ или действие" />
        <SummaryCard label="Типы задач" value={operationEntityOrder.length} hint="Бронь, заезд, уборка и другое" />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Статусы</h2>
            <p className="mt-1 text-sm text-slate-500">Единый набор для всех операционных задач.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {operationStatusOrder.map((status) => (
              <span key={status} className={`rounded-full border px-3 py-1 text-sm font-medium ${statusTone[status]}`}>
                {operationStatusLabels[status]} · {counts[status]}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Типы операций</h2>
          <div className="mt-4 space-y-2">
            {operationEntityOrder.map((type) => (
              <div key={type} className={`rounded-md border px-3 py-2 ${entityTone[type]}`}>
                <p className="text-sm font-medium text-slate-900">{operationEntityLabels[type]}</p>
              </div>
            ))}
          </div>
        </aside>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-lg font-semibold text-slate-900">Очередь задач</h2>
            <p className="mt-1 text-sm text-slate-500">Пример задач для будущей связки с коммуникациями и каналами.</p>
          </div>
          {operationsFoundationItems.map((item) => (
            <OperationRow key={item.id} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}

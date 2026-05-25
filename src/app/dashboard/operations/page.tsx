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
  new: 'border-sky-200 bg-sky-50 text-sky-800',
  in_progress: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  waiting_guest: 'border-amber-200 bg-amber-50 text-amber-800',
  waiting_executor: 'border-orange-200 bg-orange-50 text-orange-800',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  escalated: 'border-rose-200 bg-rose-50 text-rose-800',
};

const entityTone: Record<OperationEntityType, string> = {
  booking_intake: 'border-sky-200 bg-sky-50 text-sky-800',
  check_in: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  cleaning: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  maintenance: 'border-orange-200 bg-orange-50 text-orange-800',
  guest_issue: 'border-rose-200 bg-rose-50 text-rose-800',
  owner_operator_task: 'border-slate-300 bg-slate-100 text-slate-800',
};

const flowSteps = [
  'Бронь принята',
  'Доступ готов',
  'Гость заехал',
  'Уборка назначена',
  'Вопрос решён',
  'Оператор подключён',
];

const foundationNotes = [
  'Это MVP-контур: задачи и статусы уже описаны, внешние интеграции не подключены.',
  'События из коммуникаций могут стать задачами: доступ, мастер, ожидание ответа, ручная проверка.',
  'Оператор видит, кто отвечает, что ждём и какой следующий шаг нужен по объекту.',
];

function StatusBadge({ status }: { status: OperationStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone[status]}`}>
      {operationStatusLabels[status]}
    </span>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p>
    </div>
  );
}

function TaskCard({ item }: { item: OperationFoundationItem }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${entityTone[item.type]}`}>
          {operationEntityLabels[item.type]}
        </span>
        <StatusBadge status={item.status} />
        {item.communicationLinked ? (
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">
            Из коммуникаций
          </span>
        ) : null}
      </div>

      <h3 className="mt-3 text-base font-semibold text-slate-950">{item.title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase text-slate-400">Объект</dt>
          <dd className="mt-1 font-medium text-slate-800">{item.propertyLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-400">Ответственный</dt>
          <dd className="mt-1 font-medium text-slate-800">{item.owner}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-400">Срок</dt>
          <dd className="mt-1 font-medium text-slate-800">{item.dueLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-400">Источник</dt>
          <dd className="mt-1 font-medium text-slate-800">{item.sourceLabel}</dd>
        </div>
      </dl>

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs font-medium uppercase text-slate-400">Следующий шаг</p>
        <p className="mt-1 text-sm text-slate-700">{item.nextStep}</p>
      </div>
    </article>
  );
}

export default function OperationsPage() {
  const counts = countOperationsByStatus(operationsFoundationItems);
  const activeCount = operationsFoundationItems.filter((item) => item.status !== 'done').length;
  const communicationTaskCount = operationsFoundationItems.filter((item) => item.communicationLinked).length;
  const waitingCount = counts.waiting_guest + counts.waiting_executor;

  return (
    <div className="max-w-7xl space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Operations MVP</p>
        <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">Операции после брони</h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              Рабочий контур ASI для управления объектом после бронирования: заезд, доступ, уборка, мастер,
              проблемы гостя и передача оператору. Сейчас это основа продукта для российского рынка, без реальных
              внешних интеграций.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Как это связано с коммуникациями</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Сообщение гостя, звонок или ручная заметка могут стать операционной задачей с ответственным, сроком,
              статусом и следующим шагом.
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Активные задачи" value={activeCount} hint="Всё, что ещё требует действия или ожидания" />
        <SummaryCard label="Из коммуникаций" value={communicationTaskCount} hint="Сообщения и звонки, ставшие задачами" />
        <SummaryCard label="В ожидании" value={waitingCount} hint="Ждём гостя или исполнителя" />
        <SummaryCard label="Эскалации" value={counts.escalated} hint="Нужно ручное решение оператора" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-950">Статусы задач</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {operationStatusOrder.map((status) => (
                <span key={status} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${statusTone[status]}`}>
                  {operationStatusLabels[status]}: {counts[status]}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-950">Типы работ</h2>
            <div className="mt-4 space-y-2">
              {operationEntityOrder.map((type) => (
                <div key={type} className={`rounded-md border px-3 py-2 text-sm font-semibold ${entityTone[type]}`}>
                  {operationEntityLabels[type]}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-950">Основа MVP</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              {foundationNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Контур после брони</h2>
                <p className="mt-1 text-sm text-slate-500">От принятия брони до уборки, проблем гостя и эскалации.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {flowSteps.map((step, index) => (
                  <span key={step} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {index + 1}. {step}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            {operationsFoundationItems.map((item) => (
              <TaskCard key={item.id} item={item} />
            ))}
          </section>
        </div>
      </section>
    </div>
  );
}

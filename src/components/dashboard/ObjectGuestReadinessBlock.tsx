'use client';

import { TgIcon } from '@/components/TgIcon';
import type { ObjectGuestReadiness } from '@/lib/property-setup/object-guest-readiness';

type ObjectGuestReadinessBlockProps = {
  readiness: ObjectGuestReadiness;
  onGoToStep: (step: string) => void;
  compact?: boolean;
};

export function ObjectGuestReadinessBlock({
  readiness,
  onGoToStep,
  compact = false,
}: ObjectGuestReadinessBlockProps) {
  const { items, completedCount, totalCount, isReady, nextItem } = readiness;

  return (
    <section
      className={`rounded-xl border ${
        isReady ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
      } p-5 shadow-sm`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Готовность к тесту гостя</h2>
          <p className="mt-1 text-sm text-slate-600">{readiness.statusMessage}</p>
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
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {item.done ? '✓' : '—'}
                </span>
                <div>
                  <p className={`text-sm font-medium ${item.done ? 'text-slate-900' : 'text-slate-600'}`}>
                    {item.label}
                  </p>
                  {!item.done ? <p className="text-xs text-slate-500">{item.hint}</p> : null}
                </div>
              </div>
              {!item.done ? (
                <button
                  type="button"
                  onClick={() => onGoToStep(item.setupStep)}
                  className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {item.actionLabel}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!isReady && nextItem ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-950">Следующий шаг: {nextItem.label}</p>
          <p className="mt-1 text-sm text-amber-900">{nextItem.hint}</p>
          <button
            type="button"
            onClick={() => onGoToStep(nextItem.setupStep)}
            className="mt-3 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Перейти к разделу «{nextItem.label}»
          </button>
        </div>
      ) : null}

      {isReady ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-white/90 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-950">Можно запустить тест гостя</p>
          <p className="mt-1 text-sm text-emerald-900">
            ASI проверит ответы по адресу, заезду, Wi-Fi и правилам в Telegram.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={readiness.guestTestDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <TgIcon className="h-5 w-5 shrink-0" />
              Запустить тест в Telegram
            </a>
          </div>
          <p className="mt-3 text-xs text-emerald-800">
            Запасной вариант: отправьте боту команду{' '}
            <code className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-950">
              {readiness.guestTestCommand}
            </code>
          </p>
        </div>
      ) : null}
    </section>
  );
}

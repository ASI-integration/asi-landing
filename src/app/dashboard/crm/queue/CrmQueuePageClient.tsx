'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CRM_QUEUE_COLUMN_LABELS,
  CRM_QUEUE_COLUMN_VALUES,
  CRM_QUEUE_FILTER_LABELS,
  CRM_QUEUE_FILTER_VALUES,
  CrmQueueColumn,
  CrmQueueFilter,
  CrmQueueItem,
  CrmQueueMetrics,
  emptyQueueColumns,
} from '@/lib/crm/queue';
import { readResponseJson } from '@/lib/safeResponseJson';

type QueueResponse = {
  ok: boolean;
  message?: string;
  filter: CrmQueueFilter;
  metrics: CrmQueueMetrics;
  operatorInbox: CrmQueueItem[];
  columns: Record<CrmQueueColumn, CrmQueueItem[]>;
  items: CrmQueueItem[];
};

function formatDate(value: string | null): string {
  if (!value) return 'не задано';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function columnBadgeClass(column: CrmQueueColumn): string {
  switch (column) {
    case 'needs_operator':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'ready_for_cm':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'missing_data':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'completed':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-sky-50 text-sky-700 border-sky-200';
  }
}

function objectHref(item: CrmQueueItem): string {
  if (item.propertyId) return `/dashboard/properties/${item.propertyId}/setup`;
  return '/dashboard/properties';
}

function QueueCard({
  item,
  expanded,
  onToggleHistory,
}: {
  item: CrmQueueItem;
  expanded: boolean;
  onToggleHistory: () => void;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{item.objectTitle}</h3>
        <p className="text-sm text-slate-600">{item.ownerName}</p>
        {item.telegramUsername ? (
          <p className="text-xs text-slate-500">@{item.telegramUsername.replace(/^@/, '')}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${columnBadgeClass(item.column)}`}>
          {item.onboardingStatusLabel}
        </span>
        {item.readyForChannelManager ? (
          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Готов к МК
          </span>
        ) : null}
        {item.needsOperator ? (
          <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
            Требует внимания
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-1 gap-1 text-xs text-slate-600">
        <div className="flex justify-between gap-2">
          <dt>Последний контакт</dt>
          <dd className="text-slate-800">{formatDate(item.lastContactAt)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Обновлено</dt>
          <dd className="text-slate-800">{formatDate(item.updatedAt)}</dd>
        </div>
        {item.channelManagerStatus ? (
          <div className="flex justify-between gap-2">
            <dt>Менеджер каналов</dt>
            <dd className="text-slate-800">{item.channelManagerStatus}</dd>
          </div>
        ) : null}
      </dl>

      {item.missingFields.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-slate-700">Не хватает данных</p>
          <p className="text-xs text-slate-600">{item.missingFields.join(', ')}</p>
        </div>
      ) : null}

      {item.lastMessagePreview ? (
        <p className="text-xs text-slate-500 line-clamp-2">{item.lastMessagePreview}</p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href={objectHref(item)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Открыть объект
        </Link>
        <Link
          href={`/dashboard/crm?search=${encodeURIComponent(item.ownerName)}`}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          CRM карточка
        </Link>
        <Link
          href={item.channelManagerHref ?? '/dashboard/channel-connections'}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Менеджер каналов
        </Link>
        <button
          type="button"
          onClick={onToggleHistory}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {expanded ? 'Скрыть историю' : 'История общения'}
        </button>
      </div>

      {expanded ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2">
          <p className="text-xs font-medium text-slate-700">Последние сообщения</p>
          {item.messages.length === 0 ? (
            <p className="text-xs text-slate-500">Сообщений пока нет.</p>
          ) : (
            item.messages.map((message) => (
              <div key={message.id} className="text-xs">
                <div className="flex items-center justify-between gap-2 text-slate-500">
                  <span className="font-medium text-slate-700">{message.author}</span>
                  <span>{formatDate(message.createdAt)}</span>
                </div>
                <p className="text-slate-700">{message.text}</p>
              </div>
            ))
          )}
        </div>
      ) : null}
    </article>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function CrmQueuePageClient() {
  const [filter, setFilter] = useState<CrmQueueFilter>('all');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [data, setData] = useState<QueueResponse | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/crm/queue?filter=${filter}`, { credentials: 'include' });
      const payload = await readResponseJson(res, {
        ok: false,
        filter,
        metrics: {
          activeObjects: 0,
          onboarding: 0,
          readyForChannelManager: 0,
          needsAttention: 0,
          completed: 0,
        },
        operatorInbox: [],
        columns: emptyQueueColumns(),
        items: [],
        message: '',
      });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить очередь CRM.');
        return;
      }
      setData(payload);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const metrics = data?.metrics;
  const operatorInbox = data?.operatorInbox ?? [];
  const columns = data?.columns;

  const visibleColumns = useMemo(() => {
    if (!columns) return [];
    if (filter === 'needs_operator') return ['needs_operator'] as CrmQueueColumn[];
    if (filter === 'ready_for_cm') return ['ready_for_cm'] as CrmQueueColumn[];
    if (filter === 'completed') return ['completed'] as CrmQueueColumn[];
    return CRM_QUEUE_COLUMN_VALUES as unknown as CrmQueueColumn[];
  }, [columns, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Очередь CRM</h1>
          <p className="mt-1 text-sm text-slate-600">
            Единый экран объектов, лидов и подключений для пилота.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/crm"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Список лидов
          </Link>
          <button
            type="button"
            onClick={() => void loadQueue()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Обновить
          </button>
        </div>
      </div>

      {message ? <p className="text-sm text-rose-600">{message}</p> : null}

      {metrics ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MetricCard label="Активных объектов" value={metrics.activeObjects} />
          <MetricCard label="Идёт подключение" value={metrics.onboarding} />
          <MetricCard label="Готовы к Менеджеру каналов" value={metrics.readyForChannelManager} />
          <MetricCard label="Требуют внимания" value={metrics.needsAttention} />
          <MetricCard label="Завершены" value={metrics.completed} />
        </div>
      ) : null}

      <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 md:p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Требует внимания</h2>
          <p className="text-sm text-slate-600">Записи, где нужен оператор. Сортировка по времени.</p>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Загрузка...</p>
        ) : operatorInbox.length === 0 ? (
          <p className="text-sm text-slate-500">Сейчас ничего не требует внимания.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {operatorInbox.map((item) => (
              <QueueCard
                key={`inbox-${item.id}`}
                item={item}
                expanded={expandedId === `inbox-${item.id}`}
                onToggleHistory={() =>
                  setExpandedId((current) => (current === `inbox-${item.id}` ? null : `inbox-${item.id}`))
                }
              />
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {CRM_QUEUE_FILTER_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === value
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {CRM_QUEUE_FILTER_LABELS[value]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Загрузка очереди...</p>
      ) : columns ? (
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max gap-4">
            {visibleColumns.map((column) => {
              const items = columns[column] ?? [];
              return (
                <section key={column} className="w-80 shrink-0 space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <h2 className="text-sm font-semibold text-slate-900">{CRM_QUEUE_COLUMN_LABELS[column]}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {items.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {items.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">
                        Пусто
                      </p>
                    ) : (
                      items.map((item) => (
                        <QueueCard
                          key={item.id}
                          item={item}
                          expanded={expandedId === item.id}
                          onToggleHistory={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

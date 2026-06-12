import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChannelManagerObjectDataLink } from '@/components/dashboard/channel-manager/ChannelManagerObjectDataLink';
import {
  CHANNEL_MANAGER_MANUAL_ACTIONS,
  CHANNEL_MANAGER_MANUAL_LOG,
  CHANNEL_MANAGER_MANUAL_WARNINGS,
  CHANNEL_MANAGER_MOCK_CHANNELS,
  CHANNEL_MANAGER_MODES,
  CHANNEL_MANAGER_TRANSFER_ITEMS,
  channelManagerModeHasFeature,
  channelManagerModeShowsBlock,
  normalizeChannelManagerMode,
  type ChannelManagerManualActionStatus,
  type ChannelManagerMockChannel,
  type ChannelManagerReadinessStatus,
  type ChannelManagerTariffMode,
} from '@/lib/channel-manager/tariff-modes';

const modeOrder: ChannelManagerTariffMode[] = ['manual', 'assisted', 'autopilot'];

const statusTone: Record<ChannelManagerMockChannel['status'], string> = {
  'Не подключен': 'border-slate-200 bg-slate-50 text-slate-600',
  'Черновик': 'border-sky-200 bg-sky-50 text-sky-700',
  'Требует настройки': 'border-amber-200 bg-amber-50 text-amber-800',
  'Готов к ручной публикации': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Активен вручную': 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'Ошибка': 'border-red-200 bg-red-50 text-red-700',
  'Отключён': 'border-slate-200 bg-white text-slate-500',
};

const readinessTone: Record<ChannelManagerReadinessStatus, { label: string; className: string; mark: string }> = {
  done: {
    label: 'Выполнено',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    mark: '✓',
  },
  missing: {
    label: 'Не заполнено',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    mark: '!',
  },
  review: {
    label: 'Требует проверки',
    className: 'border-sky-200 bg-sky-50 text-sky-800',
    mark: '?',
  },
  not_required: {
    label: 'Не требуется',
    className: 'border-slate-200 bg-slate-50 text-slate-500',
    mark: '—',
  },
};

const actionStatusTone: Record<ChannelManagerManualActionStatus, string> = {
  'Ожидает выполнения': 'border-amber-200 bg-amber-50 text-amber-800',
  'В работе': 'border-sky-200 bg-sky-50 text-sky-800',
  'Выполнено': 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'Требует проверки': 'border-violet-200 bg-violet-50 text-violet-800',
  'Ошибка': 'border-red-200 bg-red-50 text-red-700',
};

const priorityTone: Record<'Высокий' | 'Средний' | 'Низкий', string> = {
  Высокий: 'text-red-700',
  Средний: 'text-amber-700',
  Низкий: 'text-slate-500',
};

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function ChannelList({ mode }: { mode: ChannelManagerTariffMode }) {
  const detailed = channelManagerModeHasFeature(mode, 'detailedChannels');
  const compact = channelManagerModeHasFeature(mode, 'compactChannels') || channelManagerModeHasFeature(mode, 'activeChannels');
  const channels = channelManagerModeHasFeature(mode, 'activeChannels')
    ? CHANNEL_MANAGER_MOCK_CHANNELS.filter(
        (channel) => channel.status === 'Активен вручную' || channel.status === 'Готов к ручной публикации',
      )
    : CHANNEL_MANAGER_MOCK_CHANNELS;

  if (detailed) {
    return (
      <Card
        title="Каналы ручного режима"
        subtitle="По каждому каналу видны готовность, предупреждения и следующее действие для ручного переноса."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {channels.map((channel) => (
            <ManualChannelCard key={channel.name} channel={channel} />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={compact ? 'Каналы' : 'Список каналов'}
      subtitle="Список подготовительный. Реальные отправки на площадки пока отключены."
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className="whitespace-nowrap py-2 pr-4">Канал</th>
              <th className="whitespace-nowrap px-4 py-2">Статус</th>
              {!compact ? <th className="whitespace-nowrap px-4 py-2">Тип подключения</th> : null}
              <th className="whitespace-nowrap px-4 py-2">Готовность</th>
              {!compact ? <th className="whitespace-nowrap px-4 py-2">Последнее обновление</th> : null}
              <th className="whitespace-nowrap py-2 pl-4">Ошибки</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {channels.map((channel) => (
              <tr key={channel.name} className="align-top">
                <td className="whitespace-nowrap py-3 pr-4 font-medium text-slate-900">{channel.name}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone[channel.status]}`}>
                    {channel.status}
                  </span>
                </td>
                {!compact ? <td className="whitespace-nowrap px-4 py-3 text-slate-600">{channel.connectionType}</td> : null}
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{channel.readiness}</td>
                {!compact ? <td className="whitespace-nowrap px-4 py-3 text-slate-500">{channel.lastUpdate}</td> : null}
                <td className="whitespace-nowrap py-3 pl-4 text-slate-600">
                  {channel.hasErrors ? 'Есть ошибки' : 'Нет'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ManualChannelCard({ channel }: { channel: ChannelManagerMockChannel }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{channel.name}</h3>
          <p className="mt-1 text-sm text-slate-500">{channel.connectionType}</p>
        </div>
        <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone[channel.status]}`}>
          {channel.status}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium uppercase text-slate-400">Готовность</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{channel.readiness}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium uppercase text-slate-400">Последнее обновление</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{channel.lastUpdate}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-slate-900">Следующее ручное действие</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">{channel.nextManualAction}</p>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-slate-900">Предупреждения</p>
        {channel.warningMessages.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {channel.warningMessages.map((warning) => (
              <li key={warning} className="text-sm leading-6 text-amber-800">
                {warning}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-emerald-700">Предупреждений нет</p>
        )}
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-slate-900">Чек-лист готовности</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {channel.checklist.map((item) => {
            const tone = readinessTone[item.status];
            return (
              <div key={item.label} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs ${tone.className}`}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 font-semibold">
                  {tone.mark}
                </span>
                <span className="min-w-0 flex-1">{item.label}</span>
                <span className="shrink-0 font-medium">{tone.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function ModeSwitcher({ activeMode }: { activeMode: ChannelManagerTariffMode }) {
  return (
    <Card title="Текущий режим тарифа" subtitle="Сейчас режим выбирается локально. Позже ASI сможет брать его из подписки аккаунта.">
      <div className="grid gap-3 md:grid-cols-3">
        {modeOrder.map((mode) => {
          const item = CHANNEL_MANAGER_MODES[mode];
          const active = mode === activeMode;
          return (
            <Link
              key={mode}
              href={`/dashboard/channel-manager?mode=${mode}`}
              className={`rounded-lg border px-4 py-4 transition-colors ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <p className="text-base font-semibold">{item.label}</p>
              <p className={`mt-2 text-sm leading-6 ${active ? 'text-slate-200' : 'text-slate-500'}`}>{item.summary}</p>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function ReadinessBlock() {
  const items = [
    ['Основные данные объекта', true],
    ['Адрес и правила проживания', true],
    ['Фото и описание', true],
    ['Цены и ограничения', true],
    ['Каналы для публикации', false],
  ] as const;

  return (
    <Card title="Готовность объекта" subtitle="Объект готов к публикации на 9 из 11 шагов.">
      <ul className="space-y-2">
        {items.map(([label, done]) => (
          <li key={label} className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {done ? '✓' : '—'}
            </span>
            <span className={done ? 'text-slate-900' : 'text-slate-500'}>{label}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UpdatesBlock() {
  return (
    <Card title="Очередь обновлений" subtitle="Изменения будут появляться здесь перед отправкой на площадки.">
      <p className="text-sm font-medium text-slate-900">Пока нет ожидающих обновлений</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">Реальные отправки на площадки пока отключены.</p>
    </Card>
  );
}

function ActivityBlock({ mode }: { mode: ChannelManagerTariffMode }) {
  if (mode === 'manual') {
    return (
      <Card title="Журнал ручных действий" subtitle="Пока это демонстрационный журнал без внешних отправок и без записи на площадки.">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="whitespace-nowrap py-2 pr-4">Дата</th>
                <th className="whitespace-nowrap px-4 py-2">Канал</th>
                <th className="whitespace-nowrap px-4 py-2">Действие</th>
                <th className="whitespace-nowrap px-4 py-2">Результат</th>
                <th className="whitespace-nowrap px-4 py-2">Кто выполнил</th>
                <th className="whitespace-nowrap py-2 pl-4">Комментарий</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {CHANNEL_MANAGER_MANUAL_LOG.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="whitespace-nowrap py-3 pr-4 text-slate-500">{item.dateTime}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{item.channel}</td>
                  <td className="min-w-[16rem] px-4 py-3 text-slate-700">{item.action}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.result}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.actor}</td>
                  <td className="min-w-[14rem] py-3 pl-4 text-slate-500">{item.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  const title = mode === 'autopilot' ? 'Последние важные действия' : 'Журнал действий';
  return (
    <Card title={title} subtitle="Здесь будет история значимых изменений по каналам.">
      <ul className="space-y-3 text-sm">
        <li>
          <p className="font-medium text-slate-900">Карточка объекта проверена</p>
          <p className="text-slate-500">Сегодня, 10:20 · без внешней отправки</p>
        </li>
        <li>
          <p className="font-medium text-slate-900">Цены подготовлены к проверке</p>
          <p className="text-slate-500">Вчера, 18:40 · ожидает подтверждения</p>
        </li>
      </ul>
    </Card>
  );
}

function AlertsBlock({ mode }: { mode: ChannelManagerTariffMode }) {
  return (
    <Card
      title={mode === 'autopilot' ? 'Критические ошибки' : 'Ошибки и предупреждения'}
      subtitle="Скелет показывает только безопасные статусы, без реальных вызовов к площадкам."
    >
      <p className="text-sm font-medium text-emerald-700">Критических ошибок нет</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">Активный API не включён. Автопилот работает в безопасном тестовом режиме.</p>
    </Card>
  );
}

function ManualActionsBlock() {
  return (
    <Card title="Ручные действия" subtitle="Очередь задач, которые оператор выполняет сам. Кнопки пока не сохраняют изменения.">
      <div className="space-y-3">
        {CHANNEL_MANAGER_MANUAL_ACTIONS.map((action) => (
          <div key={action.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">{action.actionType}</p>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${actionStatusTone[action.status]}`}>
                    {action.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{action.channel}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{action.hint}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                <button
                  type="button"
                  disabled
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-500"
                >
                  Отметить выполненным
                </button>
                <button
                  type="button"
                  disabled
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-500"
                >
                  Открыть данные
                </button>
              </div>
            </div>
            <p className={`mt-3 text-xs font-semibold ${priorityTone[action.priority]}`}>Приоритет: {action.priority}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ManualTransferDataBlock() {
  return (
    <Card
      title="Данные для ручного переноса"
      subtitle="ASI подготавливает текст и статусы, чтобы оператор мог спокойно перенести данные на площадки."
    >
      <div className="grid gap-3">
        {CHANNEL_MANAGER_TRANSFER_ITEMS.map((item) => {
          const tone = readinessTone[item.status];
          return (
            <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium text-slate-900">{item.title}</p>
                  <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${tone.className}`}>
                    {item.status === 'done' ? 'Готово для ручного переноса' : tone.label}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-500"
                  >
                    Открыть
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-500"
                  >
                    Скопировать
                  </button>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.text}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ManualWarningsBlock() {
  return (
    <Card title="Предупреждения ручного режима" subtitle="Ручной режим помогает подготовить данные, но не отправляет их на площадки.">
      <ul className="grid gap-2 md:grid-cols-2">
        {CHANNEL_MANAGER_MANUAL_WARNINGS.map((warning) => (
          <li key={warning} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
            {warning}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PreparedChangesBlock() {
  return (
    <Card title="Подготовленные изменения" subtitle="ASI готовит изменения, пользователь проверяет их перед применением.">
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
        <p className="font-medium text-slate-900">Цена на будни подготовлена к проверке</p>
        <p className="mt-1 text-sm leading-6 text-slate-500">Рекомендация: 5 900 ₽ за ночь, без отправки на площадки.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {['Проверить', 'Одобрить', 'Отклонить'].map((label) => (
            <button
              key={label}
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function RecommendationsBlock({ mode }: { mode: ChannelManagerTariffMode }) {
  const text =
    mode === 'assisted'
      ? 'Рекомендация по цене: проверить диапазон 5 500-6 200 ₽ перед публикацией.'
      : 'Рекомендация: сначала закрыть оставшиеся шаги готовности объекта.';

  return (
    <Card title="Рекомендации" subtitle="Подсказки остаются справочными и не меняют данные автоматически.">
      <p className="text-sm leading-6 text-slate-600">{text}</p>
    </Card>
  );
}

function SystemStatusBlock() {
  return (
    <Card title="Статус системы" subtitle="Автопилот показывает итоговое состояние без подробной ручной работы.">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-700">Состояние</p>
          <p className="mt-1 font-semibold text-emerald-900">Безопасный тестовый режим</p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Активные каналы</p>
          <p className="mt-1 font-semibold text-slate-900">3 канала готовы</p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Отправки</p>
          <p className="mt-1 font-semibold text-slate-900">Отключены</p>
        </div>
      </div>
    </Card>
  );
}

function AutopilotLimitsBlock() {
  return (
    <Card title="Ограничения автопилота" subtitle="Владелец задаёт рамки, система не выходит за них.">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Минимальная цена</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">4 800 ₽</p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Максимальная цена</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">8 900 ₽</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500">
          Поставить на паузу
        </button>
        <button type="button" disabled className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500">
          Передать оператору
        </button>
      </div>
    </Card>
  );
}

function ObjectDataBlock({ compact = false }: { compact?: boolean }) {
  return (
    <Card title="Данные объекта для каналов" subtitle="CHM остаётся отдельным мастером подготовки карточки объекта.">
      <p className={`text-sm leading-6 text-slate-600 ${compact ? 'max-w-3xl' : ''}`}>
        Откройте мастер, чтобы заполнить описание, фото, цены, правила проживания и готовность объекта.
      </p>
      <ChannelManagerObjectDataLink />
    </Card>
  );
}

export default function ChannelManagerPage({
  searchParams,
}: {
  searchParams?: { mode?: string | string[] };
}) {
  const mode = normalizeChannelManagerMode(searchParams?.mode);
  const modeConfig = CHANNEL_MANAGER_MODES[mode];

  return (
    <div className="max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Каналы</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Менеджер каналов</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Управление публикацией объекта, ценами, доступностью и обновлениями на площадках
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span className="font-medium text-slate-900">{modeConfig.label}</span>
          <span className="mx-2 text-slate-300">·</span>
          реальные отправки отключены
        </div>
      </header>

      <ModeSwitcher activeMode={mode} />

      {channelManagerModeShowsBlock(mode, 'systemStatus') ? <SystemStatusBlock /> : null}
      {mode === 'manual' ? <ObjectDataBlock compact /> : null}
      {mode === 'manual' ? <ManualWarningsBlock /> : null}
      {channelManagerModeShowsBlock(mode, 'channels') ? <ChannelList mode={mode} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {channelManagerModeShowsBlock(mode, 'readiness') ? <ReadinessBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'manualActions') ? <ManualActionsBlock /> : null}
        {mode === 'manual' ? <ManualTransferDataBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'preparedChanges') ? <PreparedChangesBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'updates') ? <UpdatesBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'alerts') ? <AlertsBlock mode={mode} /> : null}
        {channelManagerModeShowsBlock(mode, 'activity') ? <ActivityBlock mode={mode} /> : null}
        {channelManagerModeShowsBlock(mode, 'recommendations') ? <RecommendationsBlock mode={mode} /> : null}
        {channelManagerModeShowsBlock(mode, 'autopilotLimits') ? <AutopilotLimitsBlock /> : null}
        {mode !== 'manual' && channelManagerModeShowsBlock(mode, 'objectData') ? <ObjectDataBlock /> : null}
      </div>
    </div>
  );
}

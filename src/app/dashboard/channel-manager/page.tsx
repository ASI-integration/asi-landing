import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChannelManagerObjectDataLink } from '@/components/dashboard/channel-manager/ChannelManagerObjectDataLink';
import {
  CHANNEL_MANAGER_MOCK_CHANNELS,
  CHANNEL_MANAGER_MODES,
  channelManagerModeHasFeature,
  channelManagerModeShowsBlock,
  normalizeChannelManagerMode,
  type ChannelManagerMockChannel,
  type ChannelManagerTariffMode,
} from '@/lib/channel-manager/tariff-modes';

const modeOrder: ChannelManagerTariffMode[] = ['manual', 'assisted', 'autopilot'];

const statusTone: Record<ChannelManagerMockChannel['status'], string> = {
  'Не подключен': 'border-slate-200 bg-slate-50 text-slate-600',
  'Черновик': 'border-sky-200 bg-sky-50 text-sky-700',
  'Требует настройки': 'border-amber-200 bg-amber-50 text-amber-800',
  'Готов': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Активен': 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'Ошибка': 'border-red-200 bg-red-50 text-red-700',
  'Отключён': 'border-slate-200 bg-white text-slate-500',
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
  const compact = channelManagerModeHasFeature(mode, 'compactChannels') || channelManagerModeHasFeature(mode, 'activeChannels');
  const channels = channelManagerModeHasFeature(mode, 'activeChannels')
    ? CHANNEL_MANAGER_MOCK_CHANNELS.filter((channel) => channel.status === 'Активен' || channel.status === 'Готов')
    : CHANNEL_MANAGER_MOCK_CHANNELS;

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
    <Card title="Ручные действия" subtitle="Инструкции для команды, когда обновления выполняются вручную.">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="font-medium text-slate-900">Скопировать данные для площадки</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">Экспорт и копирование будут добавлены отдельным шагом.</p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
          <p className="font-medium text-slate-900">Проверить инструкции обновления</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">Команда видит, какие поля нужно перенести вручную.</p>
        </div>
      </div>
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

function ObjectDataBlock() {
  return (
    <Card title="Данные объекта для каналов" subtitle="CHM остаётся отдельным мастером подготовки карточки объекта.">
      <p className="text-sm leading-6 text-slate-600">
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
      {channelManagerModeShowsBlock(mode, 'channels') ? <ChannelList mode={mode} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {channelManagerModeShowsBlock(mode, 'readiness') ? <ReadinessBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'manualActions') ? <ManualActionsBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'preparedChanges') ? <PreparedChangesBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'updates') ? <UpdatesBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'alerts') ? <AlertsBlock mode={mode} /> : null}
        {channelManagerModeShowsBlock(mode, 'activity') ? <ActivityBlock mode={mode} /> : null}
        {channelManagerModeShowsBlock(mode, 'recommendations') ? <RecommendationsBlock mode={mode} /> : null}
        {channelManagerModeShowsBlock(mode, 'autopilotLimits') ? <AutopilotLimitsBlock /> : null}
        {channelManagerModeShowsBlock(mode, 'objectData') ? <ObjectDataBlock /> : null}
      </div>
    </div>
  );
}

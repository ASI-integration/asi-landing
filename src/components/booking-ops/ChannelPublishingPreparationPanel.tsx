'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { PublicationPackage } from '@/lib/booking-ops/channel-publishing-preparation';

type PropertySetup = { id: string; title: string | null };
type ListResponse = { ok: boolean; packages?: PublicationPackage[]; records?: PropertySetup[]; message?: string };

const PROVIDER_LABELS: Record<string, string> = { manual: 'Ручной режим', bnovo: 'Bnovo', realtycalendar: 'RealtyCalendar', travelline: 'TravelLine', other: 'Другой' };
const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик', incomplete: 'Нужны данные', ready_for_review: 'Готов к проверке',
  ready_for_publication: 'Готов к ручной/пилотной публикации', publication_pending: 'Ожидает активации провайдера',
  published_placeholder: 'Ручное подтверждение публикации', blocked: 'Заблокирован',
  not_selected: 'Не выбран', selected: 'Выбран', ready: 'Готов', missing_data: 'Нужны данные',
  publication_pending_channel: 'Ожидает публикации', published_placeholder_channel: 'Подтверждено вручную',
};
const CHANNEL_LABELS: Record<string, string> = {
  ostrovok: 'Островок', yandex_travel: 'Яндекс Путешествия', avito_travel: 'Авито Путешествия',
  sutochno: 'Суточно.ру', cian: 'ЦИАН', '101hotels': '101Hotels', bronevik: 'Броневик', kvartirka: 'Квартирка',
  ozon_travel: 'Ozon Travel', mts_travel: 'МТС Travel', onetwotrip: 'OneTwoTrip', twil: 'ТВИЛ', otello: 'Отелло', other: 'Другой',
};
const MISSING_LABELS: Record<string, string> = {
  title: 'название', safe_location: 'расположение', property_type: 'тип объекта', capacity: 'вместимость',
  photos: 'фото', description: 'описание', rules: 'правила', checkin_checkout: 'заезд и выезд',
  pricing: 'базовая цена', selected_channels: 'каналы', provider_connection: 'провайдер', channel_manager_access: 'доступ менеджера каналов', safe_payload: 'безопасность пакета',
};

export function ChannelPublishingPreparationPanel() {
  const [packages, setPackages] = useState<PublicationPackage[]>([]);
  const [setups, setSetups] = useState<PropertySetup[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [setupId, setSetupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [packagesResponse, setupsResponse] = await Promise.all([
      fetch('/api/dashboard/channel-manager/publication/packages', { credentials: 'include' }),
      fetch('/api/dashboard/property-setup/list?limit=50', { credentials: 'include' }),
    ]);
    const [packagePayload, setupPayload] = await Promise.all([
      readResponseJson<ListResponse>(packagesResponse, { ok: false }),
      readResponseJson<ListResponse>(setupsResponse, { ok: false }),
    ]);
    if (packagePayload.ok) {
      setPackages(packagePayload.packages ?? []);
      setSelectedId((current) => current || packagePayload.packages?.[0]?.id || '');
    }
    if (setupPayload.ok) {
      setSetups(setupPayload.records ?? []);
      setSetupId((current) => current || setupPayload.records?.[0]?.id || '');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const selected = packages.find((pkg) => pkg.id === selectedId) ?? packages[0] ?? null;
  const selectedChannels = useMemo(() => selected?.channels.filter((channel) => channel.selected) ?? [], [selected]);

  async function action(actionName: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/dashboard/channel-manager/publication/action', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: actionName, packageId: selected?.id, propertySetupId: selected?.propertySetupId ?? setupId, ...extra }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string; package?: PublicationPackage }>(response, { ok: false });
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'Действие не выполнено.');
      if (payload.package) setSelectedId(payload.package.id);
      setMessage('Готово. Статус обновлён.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Действие не выполнено.'); }
    finally { setBusy(false); }
  }

  async function saveChannelSelection() {
    if (!selected) return;
    const checked = Array.from(document.querySelectorAll<HTMLInputElement>('[data-publication-channel]:checked')).map((input) => input.value);
    await action('select_channels', { channelKeys: checked });
  }

  return (
    <section className="rounded-xl border border-blue-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Публикация в каналах</h2>
          <p className="mt-1 text-xs text-slate-600">Подготовка безопасного пакета для ручной или пилотной публикации. API-синхронизация будет включаться отдельно.</p>
        </div>
        {packages.length > 1 ? <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs">{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.safeSummary ?? pkg.id.slice(0, 8)}</option>)}</select> : null}
      </div>

      {!selected ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={setupId} onChange={(event) => setSetupId(event.target.value)} className="min-w-64 rounded-lg border border-slate-300 px-3 py-2" aria-label="Профиль объекта">
            <option value="">Выберите объект</option>{setups.map((setup) => <option key={setup.id} value={setup.id}>{setup.title ?? setup.id.slice(0, 8)}</option>)}
          </select>
          <button disabled={busy || !setupId} onClick={() => void action('initialize_package')} className="rounded-lg bg-blue-700 px-3 py-2 text-white disabled:opacity-50">Создать пакет</button>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Провайдер" value={PROVIDER_LABELS[selected.provider] ?? selected.provider} />
            <Stat label="Статус пакета" value={STATUS_LABELS[selected.status] ?? selected.status} />
            <Stat label="Готовность" value={`${selected.readinessScore}%`} />
            <Stat label="Следующее действие" value={selected.nextAction} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => void action('build_package')} className="rounded-lg bg-blue-700 px-3 py-1.5 text-white disabled:opacity-50">Собрать пакет</button>
            <button disabled={busy} onClick={() => void action('validate_package')} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50">Проверить</button>
            <button disabled={busy} onClick={() => void action('mark_ready_for_review')} className="rounded-lg border border-blue-300 px-3 py-1.5 text-blue-800 disabled:opacity-50">Готов к проверке</button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Выбранные каналы</p><p className="mt-1">{selectedChannels.length ? selectedChannels.map((item) => CHANNEL_LABELS[item.channelKey] ?? item.channelKey).join(', ') : 'Не выбраны'}</p></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Не хватает</p><p className="mt-1">{selected.missingFields.length ? selected.missingFields.map((key) => MISSING_LABELS[key] ?? key).join(', ') : 'Ничего'}</p></div>
          </div>
          {selected.warnings.length ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{selected.warnings.join(' ')}</p> : null}
          <details className="mt-4 border-t border-slate-100 pt-3">
            <summary className="cursor-pointer font-medium text-slate-700">Каналы и дополнительные действия</summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {selected.channels.filter((channel) => channel.channelKey !== 'other').map((channel) => (
                  <label key={channel.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span><span className="block">{CHANNEL_LABELS[channel.channelKey] ?? channel.channelKey}</span><span className="text-xs text-slate-500">{STATUS_LABELS[channel.status === 'publication_pending' ? 'publication_pending_channel' : channel.status === 'published_placeholder' ? 'published_placeholder_channel' : channel.status] ?? channel.status}</span></span>
                    <input data-publication-channel type="checkbox" value={channel.channelKey} defaultChecked={channel.selected} />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => void saveChannelSelection()} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Сохранить каналы</button>
                <button disabled={busy} onClick={() => void action('select_all_supported_channels')} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Выбрать все поддерживаемые</button>
                <button disabled={busy} onClick={() => void action('mark_ready_for_publication')} className="rounded-lg border border-blue-300 px-3 py-2 text-blue-800 disabled:opacity-50">Готов к публикации</button>
                <button disabled={busy} onClick={() => void action('mark_publication_pending')} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Ожидает публикации</button>
                <button disabled={busy} onClick={() => void action('mark_published_placeholder')} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Подтверждено вручную</button>
                <button disabled={busy} onClick={() => { const note = window.prompt('Заметка без паролей, кодов доступа и данных гостей'); if (note) void action('add_note', { note }); }} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50">Добавить заметку</button>
                <button disabled={busy} onClick={() => { const reason = window.prompt('Причина блокировки'); if (reason) void action('block_publication', { reason }); }} className="rounded-lg border border-red-200 px-3 py-2 text-red-700 disabled:opacity-50">Заблокировать</button>
              </div>
              <div><p className="font-medium text-slate-700">Проверки</p><ul className="mt-1 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">{selected.checks.map((check) => <li key={check.id}>{check.status === 'pass' ? '✓' : check.status === 'warning' ? '!' : '×'} {check.message}</li>)}</ul></div>
            </div>
          </details>
        </>
      )}
      {message ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-slate-700">{message}</p> : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-800">{value}</p></div>;
}

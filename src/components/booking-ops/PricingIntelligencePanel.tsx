'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import type { PricingProfile } from '@/lib/booking-ops/pricing-intelligence-autopilot';
import type { AudienceProfile } from '@/lib/booking-ops/property-audience-intelligence';
import type { TariffGridDay } from '@/lib/booking-ops/pricing-intelligence-autopilot';

type PropertySetup = { id: string; title: string | null };
type ProfilesResponse = { ok: boolean; profiles?: PricingProfile[]; message?: string };
type SetupsResponse = { ok: boolean; records?: PropertySetup[] };
type AudienceResponse = { ok: boolean; profile?: AudienceProfile | null; explanation?: string };
type GridResponse = { ok: boolean; days?: TariffGridDay[]; message?: string };
type MarketSource = { id: string; status: string; sourceType: string; lastSuccessAt: string | null };
type MarketCoverage = {
  coverageScore: number;
  supportedRadiiKm: number[];
  signalStatuses: Record<string, string>;
  sources: MarketSource[];
  latestIngestion: { created_at?: string; status?: string } | null;
  warnings: string[];
  nextAction: string;
};
type MarketSummaryResponse = {
  ok: boolean;
  coverage?: MarketCoverage;
  signals?: Array<{ id: string; signalDate: string; radiusKm: number; signalType: string }>;
  next7Days?: Array<{ date: string; signalTypes: string[]; radiiKm: number[]; count: number }>;
  message?: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  incomplete: 'Нужны данные',
  ready_for_recommendations: 'Готов к рекомендациям',
  recommendations_ready: 'Рекомендации готовы',
  auto_apply_ready: 'Авто-применение: пилот готов',
  auto_apply_enabled: 'Авто-применение: пилот (не live OTA)',
  blocked: 'Заблокирован',
};

const STRATEGY_LABELS: Record<string, string> = {
  balanced: 'Сбалансированная',
  occupancy_first: 'Загрузка важнее',
  adr_first: 'ADR важнее',
  aggressive_growth: 'Агрессивный рост',
  conservative: 'Консервативная',
  event_driven: 'Под события',
  custom: 'Своя',
};

const AUDIENCE_LABELS: Record<string, string> = {
  leisure_seaside: 'Отдых у моря',
  business_center: 'Деловые гости',
  family_vacation: 'Семейный отдых',
  medical_travel: 'Медицинский туризм',
  event_visitors: 'Гости мероприятий',
  students: 'Студенты',
  nightlife: 'Ночная жизнь',
  transit: 'Транзит',
  remote_work: 'Удалённая работа',
  budget: 'Бюджет',
  premium: 'Премиум',
  mixed: 'Смешанная',
  unknown: 'Не определена',
};

export function PricingIntelligencePanel() {
  const [profiles, setProfiles] = useState<PricingProfile[]>([]);
  const [setups, setSetups] = useState<PropertySetup[]>([]);
  const [setupId, setSetupId] = useState('');
  const [audience, setAudience] = useState<AudienceProfile | null>(null);
  const [audienceExplanation, setAudienceExplanation] = useState('');
  const [gridDays, setGridDays] = useState<TariffGridDay[]>([]);
  const [showFullGrid, setShowFullGrid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);

  const profile = useMemo(() => profiles.find((p) => p.propertySetupId === setupId) ?? profiles[0] ?? null, [profiles, setupId]);

  const load = useCallback(async () => {
    const [profilesRes, setupsRes] = await Promise.all([
      fetch('/api/dashboard/pricing/profiles', { credentials: 'include' }),
      fetch('/api/dashboard/property-setup/list?limit=50', { credentials: 'include' }),
    ]);
    const [profilesPayload, setupsPayload] = await Promise.all([
      readResponseJson<ProfilesResponse>(profilesRes, { ok: false }),
      readResponseJson<SetupsResponse>(setupsRes, { ok: false }),
    ]);
    if (profilesPayload.ok) setProfiles(profilesPayload.profiles ?? []);
    if (setupsPayload.ok) {
      setSetups(setupsPayload.records ?? []);
      setSetupId((current) => current || setupsPayload.records?.[0]?.id || '');
    }
  }, []);

  const loadAudience = useCallback(async (id: string) => {
    if (!id) return;
    const res = await fetch(`/api/dashboard/pricing/audience?propertySetupId=${encodeURIComponent(id)}`, { credentials: 'include' });
    const payload = await readResponseJson<AudienceResponse>(res, { ok: false });
    if (payload.ok) {
      setAudience(payload.profile ?? null);
      setAudienceExplanation(payload.explanation ?? '');
    }
  }, []);

  const loadGrid = useCallback(async (pricingProfileId: string) => {
    const res = await fetch(`/api/dashboard/pricing/tariff-grid?pricingProfileId=${encodeURIComponent(pricingProfileId)}&limit=90`, { credentials: 'include' });
    const payload = await readResponseJson<GridResponse>(res, { ok: false });
    if (payload.ok) setGridDays(payload.days ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (setupId) void loadAudience(setupId);
    const p = profiles.find((item) => item.propertySetupId === setupId);
    if (p) void loadGrid(p.id);
  }, [setupId, profiles, loadAudience, loadGrid]);

  async function action(actionName: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/dashboard/pricing/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: actionName,
          propertySetupId: setupId,
          pricingProfileId: profile?.id,
          ...extra,
        }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(response, { ok: false });
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'Действие не выполнено.');
      setMessage('Готово.');
      await load();
      if (profile) await loadGrid(profile.id);
      if (setupId) await loadAudience(setupId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Действие не выполнено.');
    } finally {
      setBusy(false);
    }
  }

  const sampleDays = showFullGrid ? gridDays : gridDays.slice(0, 7);
  const nextAction = !profile
    ? 'Инициализировать профиль ценообразования'
    : profile.missingFields.length
      ? `Заполнить: ${profile.missingFields.join(', ')}`
      : profile.status === 'recommendations_ready'
        ? 'Можно отметить готовность к пилотному авто-применению'
        : profile.status === 'auto_apply_enabled'
          ? 'Пилот готов — live-пуш в OTA не выполняется'
          : 'Сгенерировать тарифную сетку';

  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Цены / тарифы</h2>
          <p className="mt-1 text-xs text-slate-600">
            Основа динамического ценообразования: рекомендации и тарифная сетка. Не live-цены в OTA.
          </p>
        </div>
        <select
          value={setupId}
          onChange={(e) => setSetupId(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          aria-label="Объект"
        >
          <option value="">Выберите объект</option>
          {setups.map((s) => <option key={s.id} value={s.id}>{s.title ?? s.id.slice(0, 8)}</option>)}
        </select>
      </div>

      {!profile ? (
        <div className="mt-3">
          <button
            type="button"
            disabled={busy || !setupId}
            onClick={() => void action('initialize_profile')}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-white disabled:opacity-50"
          >
            Инициализировать ценообразование
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Статус" value={STATUS_LABELS[profile.status] ?? profile.status} />
            <Stat label="Стратегия" value={STRATEGY_LABELS[profile.pricingStrategy] ?? profile.pricingStrategy} />
            <Stat label="Готовность" value={`${profile.readinessScore}%`} />
            <Stat label="Базовая цена" value={profile.basePrice ? `${profile.basePrice} ${profile.currency}` : '—'} />
            <Stat label="Мин / макс" value={profile.minPrice && profile.maxPrice ? `${profile.minPrice} – ${profile.maxPrice}` : '—'} />
            <Stat label="Аудитория" value={AUDIENCE_LABELS[audience?.primaryAudience ?? 'unknown'] ?? '—'} />
            <Stat label="Уверенность аудитории" value={audience ? `${audience.confidenceScore}%` : '—'} />
            <Stat label="Следующий шаг" value={nextAction} />
          </div>

          {profile.missingFields.length > 0 ? (
            <p className="mt-2 text-xs text-amber-700">Не заполнено: {profile.missingFields.join(', ')}</p>
          ) : null}

          {profile.status === 'auto_apply_enabled' ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Пилотное авто-применение включено. Это не live-пуш цен в OTA или менеджер каналов.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void action('infer_audience')} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">Определить аудиторию</button>
            <button type="button" disabled={busy} onClick={() => void action('update_guardrails', { guardrails: { pricing_strategy: 'balanced' } })} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">Стратегия: сбаланс.</button>
            <button type="button" disabled={busy} onClick={() => void action('generate_tariff_grid', { days: 30 })} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">Сетка 30 дн.</button>
            <button type="button" disabled={busy} onClick={() => void action('generate_tariff_grid', { days: 60 })} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">60 дн.</button>
            <button type="button" disabled={busy} onClick={() => void action('generate_tariff_grid', { days: 90 })} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">90 дн.</button>
            <button type="button" disabled={busy} onClick={() => void action('run_recommendation', { days: 30 })} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">Расчёт рекомендаций</button>
            <button type="button" disabled={busy} onClick={() => void action('mark_recommendations_ready')} className="rounded border border-emerald-400 px-2 py-1 text-xs disabled:opacity-50">Рекомендации готовы</button>
            <button type="button" disabled={busy} onClick={() => void action('mark_auto_apply_ready')} className="rounded border border-emerald-500 px-2 py-1 text-xs disabled:opacity-50">Авто-применение: пилот</button>
            <button type="button" disabled={busy} onClick={() => void action('mark_auto_apply_enabled_placeholder')} className="rounded border border-amber-400 px-2 py-1 text-xs disabled:opacity-50">Включить пилот (placeholder)</button>
            <button type="button" disabled={busy} onClick={() => void action('block_pricing', { reason: 'Заблокировано оператором' })} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50">Заблокировать</button>
          </div>

          {sampleDays.length > 0 ? (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-slate-700">
                  {showFullGrid ? `Тарифная сетка (${gridDays.length} дн.)` : 'Ближайшие 7 дней'}
                </h3>
                {gridDays.length > 7 ? (
                  <button type="button" onClick={() => setShowFullGrid(!showFullGrid)} className="text-xs text-emerald-700 underline">
                    {showFullGrid ? 'Свернуть' : `Показать все (${gridDays.length})`}
                  </button>
                ) : null}
              </div>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1 pr-2">Дата</th>
                      <th className="py-1 pr-2">Рекоменд.</th>
                      <th className="py-1 pr-2">Спрос</th>
                      <th className="py-1">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleDays.map((day) => (
                      <tr key={day.date} className="border-t border-slate-100">
                        <td className="py-1 pr-2">{day.date}</td>
                        <td className="py-1 pr-2">{day.recommendedPrice ?? '—'} ₽</td>
                        <td className="py-1 pr-2">{day.demandScore}</td>
                        <td className="py-1">{day.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <button type="button" onClick={() => setExpanded(!expanded)} className="mt-2 text-xs text-slate-500 underline">
            {expanded ? 'Скрыть пояснение' : 'Показать пояснение'}
          </button>
          {expanded ? (
            <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {audienceExplanation || 'Определите аудиторию объекта для более точных рекомендаций.'}
              {' '}
              Рекомендации строятся по прозрачным правилам: день недели, сезон, конкуренты, предложение, события, погода и профиль аудитории.
            </p>
          ) : null}
        </>
      )}

      <MarketSignalsPanel propertySetupId={setupId} />

      {message ? <p className="mt-2 text-xs text-slate-600">{message}</p> : null}
    </section>
  );
}

const SIGNAL_LABELS: Record<string, string> = {
  competitor_prices: 'Цены конкурентов',
  available_supply: 'Доступное предложение',
  event_pressure: 'События',
  weather_pressure: 'Погода',
  channel_snapshot: 'Снимок каналов',
};

function MarketSignalsPanel({ propertySetupId }: { propertySetupId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [summary, setSummary] = useState<MarketSummaryResponse | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [date, setDate] = useState(today);
  const [radius, setRadius] = useState(3);
  const [median, setMedian] = useState('');
  const [competitorCount, setCompetitorCount] = useState('');
  const [availableCount, setAvailableCount] = useState('');
  const [totalCount, setTotalCount] = useState('');
  const [eventName, setEventName] = useState('');
  const [weatherCondition, setWeatherCondition] = useState('');
  const [weatherImpact, setWeatherImpact] = useState('neutral');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!propertySetupId) { setSummary(null); return; }
    const response = await fetch(`/api/dashboard/pricing/market-signals?propertySetupId=${encodeURIComponent(propertySetupId)}`, { credentials: 'include' });
    const payload = await readResponseJson<MarketSummaryResponse>(response, { ok: false });
    setSummary(payload);
    if (!payload.ok) setMessage(payload.message ?? 'Не удалось загрузить сигналы.');
  }, [propertySetupId]);

  useEffect(() => { void load(); }, [load]);

  async function marketAction(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/dashboard/pricing/market-signals/action', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, propertySetupId, ...extra }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string; result?: { score?: number } }>(response, { ok: false });
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? 'Действие не выполнено.');
      setMessage(action === 'compute_market_pressure' && payload.result?.score != null ? `Рыночное давление: ${payload.result.score}/100.` : 'Готово.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Действие не выполнено.'); }
    finally { setBusy(false); }
  }

  async function submitSnapshot() {
    const competitor = median || competitorCount ? { median: median ? Number(median) : undefined, count: competitorCount ? Number(competitorCount) : undefined } : undefined;
    const supply = availableCount || totalCount ? {
      available_count: availableCount ? Number(availableCount) : undefined,
      total_count: totalCount ? Number(totalCount) : undefined,
    } : undefined;
    const events = eventName ? [{ name: eventName, date, expected_impact: 'high' }] : undefined;
    const weather = weatherCondition ? { date, condition: weatherCondition, impact: weatherImpact } : undefined;
    await marketAction('ingest_manual_snapshot', { snapshot: { date, radius_km: radius, competitor_prices: competitor, available_supply: supply, events, weather } });
    setShowForm(false);
  }

  const coverage = summary?.coverage;
  const primarySource = coverage?.sources[0];
  return (
    <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">Рынок / спрос</h3>
          <p className="mt-0.5 text-xs text-slate-600">Ручные и подготовленные к подключению источники. Live-поставщики не подключены.</p>
        </div>
        <button type="button" disabled={busy || !propertySetupId} onClick={() => void load()} className="rounded border border-sky-300 px-2 py-1 text-xs disabled:opacity-50">Обновить</button>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Покрытие" value={coverage ? `${coverage.coverageScore}%` : '—'} />
        <Stat label="Радиусы" value={coverage?.supportedRadiiKm.map((value) => `${value} км`).join(' / ') ?? '1 / 3 / 7 / 10 км'} />
        <Stat label="Последняя загрузка" value={coverage?.latestIngestion?.created_at?.slice(0, 16).replace('T', ' ') ?? 'Нет'} />
        <Stat label="Следующий шаг" value={coverage?.nextAction ?? 'Выберите объект'} />
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {Object.entries(SIGNAL_LABELS).map(([type, label]) => (
          <span key={type} className={`rounded-full border px-2 py-1 ${coverage?.signalStatuses[type] === 'available' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-white text-slate-600'}`}>
            {label}: {coverage?.signalStatuses[type] === 'available' ? 'есть' : 'нет'}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !propertySetupId} onClick={() => setShowForm(!showForm)} className="rounded border border-sky-400 px-2 py-1 text-xs disabled:opacity-50">Добавить снимок рынка</button>
        <button type="button" disabled={busy || !propertySetupId} onClick={() => void marketAction('import_channel_pricing_signals')} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50">Импортировать цены каналов</button>
        <button type="button" disabled={busy || !primarySource} onClick={() => void marketAction('run_ingestion', { sourceId: primarySource?.id, dryRun: true })} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50">Пробный запуск</button>
        <button type="button" disabled={busy || !propertySetupId} onClick={() => void marketAction('compute_market_pressure', { date })} className="rounded border border-violet-300 bg-white px-2 py-1 text-xs disabled:opacity-50">Рассчитать давление</button>
        {!primarySource ? <button type="button" disabled={busy || !propertySetupId} onClick={() => void marketAction('initialize_source', { sourceType: 'manual', provider: 'manual' })} className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs disabled:opacity-50">Создать источник</button> : null}
        <button type="button" disabled={busy || !primarySource} onClick={() => void marketAction('block_source', { sourceId: primarySource?.id, reason: 'Заблокировано оператором.' })} className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 disabled:opacity-50">Заблокировать источник</button>
        <button type="button" disabled={busy || !primarySource} onClick={() => { const note = window.prompt('Заметка об источнике'); if (note) void marketAction('add_note', { sourceId: primarySource?.id, note }); }} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50">Добавить заметку</button>
      </div>

      {showForm ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-sky-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs">Дата<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-xs">Радиус<select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1">{[1, 3, 7, 10].map((value) => <option key={value} value={value}>{value} км</option>)}</select></label>
          <label className="text-xs">Медианная цена<input inputMode="numeric" value={median} onChange={(e) => setMedian(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-xs">Конкурентов<input inputMode="numeric" value={competitorCount} onChange={(e) => setCompetitorCount(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-xs">Доступно<input inputMode="numeric" value={availableCount} onChange={(e) => setAvailableCount(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-xs">Всего предложений<input inputMode="numeric" value={totalCount} onChange={(e) => setTotalCount(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-xs">Событие<input value={eventName} onChange={(e) => setEventName(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-xs">Погода<input value={weatherCondition} onChange={(e) => setWeatherCondition(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-xs">Влияние погоды<select value={weatherImpact} onChange={(e) => setWeatherImpact(e.target.value)} className="mt-1 w-full rounded border px-2 py-1"><option value="positive">Положительное</option><option value="neutral">Нейтральное</option><option value="medium_negative">Умеренно негативное</option><option value="high_negative">Сильно негативное</option></select></label>
          <div className="flex items-end"><button type="button" disabled={busy} onClick={() => void submitSnapshot()} className="rounded bg-sky-700 px-3 py-1.5 text-xs text-white disabled:opacity-50">Сохранить снимок</button></div>
        </div>
      ) : null}

      {(summary?.next7Days?.length ?? 0) > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-medium text-slate-700">Ближайшие 7 дней</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {summary?.next7Days?.map((day) => <span key={day.date} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs">{day.date}: {day.count}</span>)}
          </div>
        </div>
      ) : null}

      <button type="button" onClick={() => setShowDetails(!showDetails)} className="mt-2 text-xs text-sky-700 underline">{showDetails ? 'Скрыть детали' : 'Детали по радиусам'}</button>
      {showDetails ? (
        <div className="mt-1 grid gap-1 sm:grid-cols-4">
          {[1, 3, 7, 10].map((value) => <Stat key={value} label={`${value} км`} value={`${summary?.signals?.filter((signal) => signal.radiusKm === value).length ?? 0} сигналов`} />)}
        </div>
      ) : null}
      {coverage?.warnings?.length ? <p className="mt-2 text-xs text-amber-700">{coverage.warnings.join(' ')}</p> : null}
      {message ? <p className="mt-2 text-xs text-slate-700">{message}</p> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xs font-medium text-slate-800">{value}</div>
    </div>
  );
}

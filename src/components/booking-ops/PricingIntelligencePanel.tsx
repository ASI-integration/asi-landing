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

      {message ? <p className="mt-2 text-xs text-slate-600">{message}</p> : null}
    </section>
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

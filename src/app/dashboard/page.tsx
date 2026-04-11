'use client';

import { useTranslation } from '@/i18n/useTranslation';
import { productSupportEmail } from '@/config/contact';
import { useSession } from '@/contexts/SessionContext';
import { useEffect, useMemo, useState } from 'react';

function formatDateRu(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { year: 'numeric', month: 'short', day: 'numeric' });
}

function planLabel(plan: string | null | undefined) {
  if (plan === 'small') return 'Базовый';
  if (plan === 'growth') return 'Масштабирование';
  if (plan === 'enterprise') return 'Крупный портфель';
  return '—';
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const account = session?.account ?? null;
  const [vkStatus, setVkStatus] = useState<'not_connected' | 'pending' | 'connected' | 'error'>('not_connected');
  const [vkErrorHint, setVkErrorHint] = useState<string | null>(null);

  const vkBadge = useMemo(() => {
    if (vkStatus === 'connected') return { label: 'Подключено', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (vkStatus === 'pending') return { label: 'Ожидает подтверждения', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    if (vkStatus === 'error') return { label: 'Ошибка', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
    return { label: 'Не подключено', cls: 'bg-slate-50 text-slate-700 border-slate-200' };
  }, [vkStatus]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/channels', { method: 'GET' });
        if (!res.ok) return;
        const data = await res.json();
        const channels = Array.isArray(data?.channels) ? data.channels : [];
        const vk = channels.find((c: any) => c?.type === 'vk') ?? null;
        if (!vk) {
          if (!cancelled) {
            setVkStatus('not_connected');
            setVkErrorHint(null);
          }
          return;
        }
        const status = String(vk.status || '').toLowerCase();
        const mapped =
          status === 'connected' ? 'connected' :
          status === 'pending' ? 'pending' :
          status === 'error' ? 'error' :
          'not_connected';
        if (!cancelled) {
          setVkStatus(mapped);
          const lastErr = vk?.settings_json?.last_error;
          setVkErrorHint(typeof lastErr === 'string' && lastErr.trim() ? lastErr : null);
        }
      } catch {
        // ignore
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t('dashboard.overview.title')}
        </h1>
        <p className="mt-1 text-slate-600">
          {t('dashboard.overview.subtitle')}
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">Рабочее пространство</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {account?.name ?? '—'}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">Тариф</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {planLabel(account?.plan_code)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">Тестовый период</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            до {formatDateRu(account?.trial_ends_at ?? null)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Статус: {account?.subscription_status ?? '—'}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Подключить каналы
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Минимальный старт: подключите 1 канал — Telegram, Email или VK.
        </p>

        <div className="mt-5 grid sm:grid-cols-3 gap-4">
          <a
            href="https://t.me/ASI_core_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-slate-200 p-4 hover:border-slate-400 hover:bg-slate-50 transition-all"
          >
            <p className="text-sm font-semibold text-slate-900">Telegram</p>
            <p className="mt-1 text-xs text-slate-600">Открыть бота и начать подключение.</p>
            <p className="mt-3 text-xs text-slate-500 group-hover:text-slate-700">t.me/ASI_core_bot</p>
          </a>
          <a
            href={`mailto:${productSupportEmail}?subject=${encodeURIComponent('Подключение Email канала')}`}
            className="group rounded-xl border border-slate-200 p-4 hover:border-slate-400 hover:bg-slate-50 transition-all"
          >
            <p className="text-sm font-semibold text-slate-900">Email</p>
            <p className="mt-1 text-xs text-slate-600">Запросить подключение Email‑канала.</p>
            <p className="mt-3 text-xs text-slate-500 group-hover:text-slate-700">{productSupportEmail}</p>
          </a>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">VK</p>
                <p className="mt-1 text-xs text-slate-600">
                  Подключите VK через OAuth (v1).
                </p>
              </div>
              <span className={`text-[11px] px-2 py-1 rounded-full border ${vkBadge.cls}`}>
                {vkBadge.label}
              </span>
            </div>

            {vkStatus === 'error' && vkErrorHint ? (
              <p className="mt-2 text-xs text-rose-700">
                {vkErrorHint}
              </p>
            ) : null}

            <div className="mt-3 flex items-center gap-2">
              <a
                href="/api/connect/vk/start"
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 text-white text-xs px-3 py-2 hover:bg-slate-800 transition-colors"
              >
                {vkStatus === 'connected' ? 'Переподключить' : 'Подключить VK'}
              </a>
              <a
                href="https://vk.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-600 hover:text-slate-900"
              >
                Открыть VK
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('dashboard.overview.activityTitle')}
        </h2>
        <ul className="mt-4 space-y-3">
          <li className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-slate-700">{t('dashboard.overview.activity1')}</span>
          </li>
          <li className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-slate-700">{t('dashboard.overview.activity2')}</span>
          </li>
          <li className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-slate-700">{t('dashboard.overview.activity3')}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

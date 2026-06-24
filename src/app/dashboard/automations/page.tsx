'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/contexts/SessionContext';

const ACTIVE_AUTOMATIONS = [
  'заявки из CRM',
  'проверка готовности объекта',
  'создание OPS-задач',
  'Telegram-коммуникация и автоэскалации',
  'авто-поддержка через Support Bot',
] as const;

const PLANNED_AUTOMATIONS = [
  'массовое подключение объектов',
  'внешние OTA-интеграции',
  'полная автоматизация заселения/выезда',
  'расширенная аналитика',
] as const;

export default function AutomationsPage() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (session?.isCrmOperator !== true) {
      router.replace('/dashboard');
    }
  }, [loading, router, session?.isCrmOperator]);

  if (loading || session?.isCrmOperator !== true) {
    return null;
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Автоматизация</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          ASI постепенно включает автоматизацию по мере готовности объекта и пилота. Сначала система
          помогает с заявками, объектами, коммуникацией и OPS-задачами. Полный автопилот включается
          только после проверки объекта.
        </p>
      </header>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-900">Что уже автоматизировано</h2>
        <ul className="space-y-2 text-base text-slate-700 leading-relaxed">
          {ACTIVE_AUTOMATIONS.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-emerald-600" aria-hidden>
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-900">Что включается позже</h2>
        <ul className="space-y-2 text-base text-slate-600 leading-relaxed">
          {PLANNED_AUTOMATIONS.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-slate-400" aria-hidden>
                ·
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

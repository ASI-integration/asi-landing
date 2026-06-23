'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/contexts/SessionContext';

const STATUS_BLOCKS = [
  {
    title: 'Поддержка',
    status: 'Готовится',
    description: 'Запросы из Telegram будут автоматически попадать в CRM и OPS.',
  },
  {
    title: 'Коммуникации',
    status: 'Частично работает',
    description: 'Гостевые сообщения могут создавать задачи для оператора.',
  },
  {
    title: 'OPS-задачи',
    status: 'Работает',
    description: 'Система создаёт задачи по готовности объекта, броням и обращениям.',
  },
  {
    title: 'Бронирования',
    status: 'В работе',
    description: 'После добавления брони создаются задачи заезда, выезда и уборки.',
  },
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
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Автопилот</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Здесь будет управление автоматическими сценариями: поддержка, коммуникации с гостями,
          OPS-задачи и уведомления. Сейчас автопилот включается поэтапно через объекты, бронирования
          и Telegram.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {STATUS_BLOCKS.map((block) => (
          <article
            key={block.title}
            className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">{block.title}</h2>
              <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {block.status}
              </span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{block.description}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

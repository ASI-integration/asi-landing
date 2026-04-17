'use client';

import { useSession } from '@/contexts/SessionContext';

export default function SettingsPage() {
  const { session } = useSession();
  const email = session?.user?.email ?? '—';
  const accountName = session?.account?.name ?? '—';

  return (
    <div className="space-y-8 max-w-2xl">

      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Настройки</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Управление аккаунтом, рабочим пространством и параметрами доступа.
        </p>
      </header>

      {/* Account info — read-only for now */}
      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Аккаунт</h2>
        <div className="mt-5 space-y-4">
          <div className="flex items-start justify-between py-3 border-b border-slate-100">
            <div>
              <p className="text-sm text-slate-500">Email</p>
              <p className="mt-1 text-base font-medium text-slate-900">{email}</p>
            </div>
          </div>
          <div className="flex items-start justify-between py-3 border-b border-slate-100">
            <div>
              <p className="text-sm text-slate-500">Рабочее пространство</p>
              <p className="mt-1 text-base font-medium text-slate-900">{accountName}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Sections coming later */}
      <section className="bg-slate-50 rounded-xl border border-slate-200 p-7">
        <h2 className="text-lg font-bold text-slate-900">Скоро в этом разделе</h2>
        <ul className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed">
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Управление паролем и данными аккаунта</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Настройка рабочего пространства и названия компании</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Управление доступом участников команды</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Уведомления и предпочтения связи</span>
          </li>
        </ul>
      </section>

    </div>
  );
}

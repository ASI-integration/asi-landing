'use client';

import { useSession } from '@/contexts/SessionContext';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const { session } = useSession();
  const router = useRouter();
  const email = session?.user?.email ?? 'demo@asi-global.ru';

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  return (
    <div className="space-y-6">
      {/* Title + demo badge */}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Личный кабинет
        </h1>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
          Демо-доступ активен
        </span>
      </header>

      {/* Account block */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Аккаунт</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-slate-500 w-32 shrink-0">Email:</dt>
            <dd className="text-slate-900 font-medium">{email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-32 shrink-0">Тариф:</dt>
            <dd className="text-slate-900">Autopilot Pro</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-32 shrink-0">Статус:</dt>
            <dd className="text-emerald-600 font-medium">Демо-доступ</dd>
          </div>
        </dl>
      </div>

      {/* Object block */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Объекты</h2>
        <div className="border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900">ASI Demo Property</p>
              <p className="mt-0.5 text-sm text-slate-500">Апартаменты · Москва</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
              Активен
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-slate-500">Гостей (30д)</dt>
              <dd className="font-semibold text-slate-900">14</dd>
            </div>
            <div>
              <dt className="text-slate-500">Загрузка</dt>
              <dd className="font-semibold text-slate-900">78%</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Integrations */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Интеграции и платежи</h2>
        <ul className="space-y-3 text-sm">
          <li className="flex items-center justify-between">
            <span className="text-slate-700">ЮKassa</span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              Подключение в процессе
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-slate-700">Telegram-бот</span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
              Активен
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-slate-700">Менеджер каналов</span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
              Не подключён
            </span>
          </li>
        </ul>
      </div>

      {/* Logout */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Выйти из аккаунта</h2>
        <p className="text-sm text-slate-500 mb-4">
          Демо-сессия завершится, и вы вернётесь на страницу входа.
        </p>
        <button
          onClick={handleLogout}
          className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

'use client';

import { useSession } from '@/contexts/SessionContext';
import { useEffect, useState } from 'react';

export default function SettingsPage() {
  const { session } = useSession();
  const email = session?.user?.email ?? '—';
  const accountName = session?.account?.name ?? '—';
  const [yandexAvailable,setYandexAvailable]=useState(false);
  const [linkError,setLinkError]=useState(false);
  useEffect(()=>{
    if(new URLSearchParams(window.location.search).get('yandex_error')==='recent_auth_required')
      setLinkError(true);
  },[]);
  useEffect(()=>{
    let active=true;
    void fetch('/api/auth/ru-methods',{cache:'no-store'})
      .then(r=>r.ok?r.json():null)
      .then(j=>{if(active)setYandexAvailable(j?.market==='ru'&&j?.yandexId===true);})
      .catch(()=>{if(active)setYandexAvailable(false);});
    return ()=>{active=false;};
  },[]);

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

      {yandexAvailable && <section className="rounded-xl border border-slate-200 bg-white p-7">
        <h2 className="text-lg font-bold text-slate-900">Яндекс ID</h2>
        <p className="mt-2 text-sm text-slate-600">Привяжите Яндекс к существующему аккаунту ASI, чтобы позже входить без Google и пароля. Для защиты аккаунта потребуется недавний вход по паролю или одноразовому коду.</p>
        {linkError && <p role="alert" className="mt-3 text-sm text-amber-800">Сначала повторно подтвердите вход в ASI. <a className="underline" href="/login?redirect=%2Fdashboard%2Fsettings">Перейти ко входу</a>.</p>}
        <a href="/api/auth/yandex/start?mode=link&redirect=%2Fdashboard%2Fsettings"
          className="mt-4 inline-block rounded-lg border border-slate-900 px-4 py-3 text-sm font-semibold text-slate-900">
          Привязать Яндекс ID
        </a>
      </section>}

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

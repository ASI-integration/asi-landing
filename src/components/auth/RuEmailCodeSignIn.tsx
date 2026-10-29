'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { safeAuthRedirectPath } from '@/lib/auth/app-url';

type RuMethods={market:'ru'|'other';emailCode:boolean;password:boolean;yandexId:boolean;googleOptional:boolean};

/** Shared RU entry point for all ASI surfaces using the existing session cookie. */
export function RuEmailCodeSignIn({redirectPath='/dashboard'}:{redirectPath?:string}) {
  const [methods,setMethods]=useState<RuMethods|null>(null);
  const [email,setEmail]=useState('');
  const [code,setCode]=useState('');
  const [sent,setSent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');

  useEffect(()=>{
    let active=true;
    const ctrl=new AbortController();
    void fetch('/api/auth/ru-methods',{cache:'no-store',signal:ctrl.signal})
      .then(r=>r.ok?r.json():null)
      .then((value:RuMethods|null)=>{if(active)setMethods(value);})
      .catch(()=>{if(active)setMethods(null);});
    return ()=>{active=false;ctrl.abort();};
  },[]);

  if(!methods || methods.market!=='ru')return null;

  const requestCode=async(e:FormEvent)=>{
    e.preventDefault();
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try {
      const res=await fetch('/api/auth/email-code/request',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:email.trim().toLowerCase()}),
        credentials:'same-origin',
      });
      if(!res.ok){setError('Отправка кода пока недоступна. Используйте вход по паролю.');return;}
      setSent(true);
      setMessage('Если адрес указан верно, письмо с кодом будет отправлено. Проверьте также папку «Спам».');
    }catch{setError('Не удалось связаться с сервером. Попробуйте позже.');}
    finally{setBusy(false);}
  };
  const verifyCode=async(e:FormEvent)=>{
    e.preventDefault();
    if(busy||!/^[0-9]{8}$/.test(code))return;
    setBusy(true);setError('');
    try{
      const res=await fetch('/api/auth/email-code/verify',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:email.trim().toLowerCase(),code}),
        credentials:'same-origin',
      });
      if(!res.ok){setError(res.status===401?'Неверный или просроченный код. Запросите новый.':'Вход временно недоступен.');return;}
      // Full navigation reloads the existing SessionProvider and owner access.
      window.location.assign(safeAuthRedirectPath(redirectPath));
    }catch{setError('Не удалось проверить код. Попробуйте ещё раз.');}
    finally{setBusy(false);}
  };

  return <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Вход в ASI по email">
    <p className="text-sm font-semibold text-slate-900">Вход по email-коду</p>
    {methods.emailCode ? <>
      <p className="mt-1 text-xs text-slate-600">Без пароля и Google. Код действует 10 минут.</p>
      <form onSubmit={sent?verifyCode:requestCode} className="mt-3 space-y-3">
        <label htmlFor="ru-code-email" className="block text-xs font-medium text-slate-700">Электронная почта</label>
        <input id="ru-code-email" type="email" autoComplete="email" required maxLength={254}
          value={email} onChange={e=>{setEmail(e.target.value);setSent(false);setCode('');}}
          disabled={busy||sent} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          placeholder="you@company.ru" />
        {sent&&<>
          <label htmlFor="ru-code-input" className="block text-xs font-medium text-slate-700">Код из письма</label>
          <input id="ru-code-input" type="text" autoComplete="one-time-code" inputMode="numeric"
            pattern="[0-9]{8}" maxLength={8} required value={code}
            onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,8))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 tracking-widest" />
        </>}
        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-60">
          {busy?'Проверяем…':sent?'Войти':'Получить код'}
        </button>
        {sent&&<button type="button" className="text-sm text-slate-700 underline"
          onClick={()=>{setSent(false);setCode('');setMessage('');}} disabled={busy}>
          Запросить новый код
        </button>}
      </form>
    </> : <p className="mt-2 text-xs text-slate-600">
      Способ подключения готовится. Пока используйте существующий вход по паролю — аккаунты сохраняются.
    </p>}
    {message&&<p role="status" className="mt-2 text-xs text-slate-600">{message}</p>}
    {error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    {!methods.yandexId&&<p className="mt-3 text-xs text-slate-500">
      Яндекс ID появится после регистрации приложения и проверки безопасности. Google остаётся необязательным.
    </p>}
  </section>;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BOOKING_SITES, CONNECTION_STEPS, EMPTY_CONNECTION, MANAGERS, RU_SETUP_PATH, validateConnection, type RentalConnectionDraft } from '@/lib/rental-connect/model';

type Connection = {
  draft: RentalConnectionDraft;
  readiness: { ready: boolean; checks: { id: string; labelRu: string; ok: boolean }[] } | null;
  pilotStatus: string | null;
};
const inputClass = 'mt-2 w-full rounded border border-asi-border bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-asi-gold';
const buttonClass = 'min-h-12 px-6 py-3 bg-asi-navy text-white font-semibold rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-asi-gold disabled:opacity-50';

export function RentalConnectionFlow() {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [draft, setDraft] = useState<RentalConnectionDraft>(EMPTY_CONNECTION);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/cabinet/connect', { cache: 'no-store' });
      if (res.status === 401) { router.replace(`/ru/connect?redirect=${encodeURIComponent(RU_SETUP_PATH)}`); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setConnection(data); setDraft(data.draft); setStep(data.draft.step);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить данные.'); }
    finally { setLoading(false); }
  }, [router]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!loading) headingRef.current?.focus(); }, [step, loading]);

  const patch = (values: Partial<RentalConnectionDraft>) => setDraft((current) => ({ ...current, ...values }));
  const field = (key: 'name' | 'address' | 'description' | 'rules' | 'checkIn' | 'checkOut' | 'wifiName' | 'wifiPassword' | 'instructions', label: string, options: { multiline?: boolean; optional?: boolean; type?: string } = {}) => (
    <label className="block text-base font-medium" key={key}>
      {label}{options.optional ? <span className="font-normal text-slate-500"> — необязательно</span> : null}
      {options.multiline ? <textarea className={inputClass} value={draft[key]} onChange={(e) => patch({ [key]: e.target.value })} rows={3} required={!options.optional} maxLength={5000} /> :
        <input className={inputClass} type={options.type ?? 'text'} value={draft[key]} onChange={(e) => patch({ [key]: e.target.value })} required={!options.optional} maxLength={300} autoComplete={key === 'wifiPassword' ? 'off' : undefined} />}
    </label>
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validateConnection(draft, step);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    const { manager, otherManager, channels, name, address, description, rules, checkIn, checkOut, wifiName, wifiPassword, instructions, photosLater, communityMember } = draft;
    const values = step === 0 ? { manager, otherManager } : step === 1 ? { channels } :
      { name, address, description, rules, checkIn, checkOut, wifiName, wifiPassword, instructions, photosLater, communityMember };
    try {
      const res = await fetch('/api/cabinet/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step, values }) });
      if (res.status === 401) { setError('Сеанс завершён. Войдите снова, чтобы сохранить этот шаг.'); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setConnection(data); setDraft(data.draft); setStep(data.draft.step);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить. Повторите попытку.'); }
    finally { setBusy(false); }
  }

  if (loading) return <p role="status" className="p-8">Загружаем ваши данные…</p>;
  if (!connection) return <div role="alert" className="space-y-4"><p>{error}</p><button onClick={() => void load()} className={buttonClass}>Попробовать ещё раз</button></div>;

  return (
    <div className="max-w-4xl mx-auto text-asi-navy">
      <p className="text-sm text-asi-gold-text font-semibold">Подключение объекта · шаг {step + 1} из 4</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-3xl sm:text-4xl font-serif focus:outline-none">{CONNECTION_STEPS[step]}</h1>
      <ol aria-label="Шаги подключения" className="my-7 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CONNECTION_STEPS.map((label, i) => <li key={label} aria-current={i === step ? 'step' : undefined} className={`border-t-2 pt-3 text-sm ${i === step ? 'border-asi-gold font-semibold' : 'border-slate-200 text-slate-500'}`}>{i + 1}. {label}</li>)}
      </ol>

      <div className="bg-asi-paper border border-asi-border p-5 sm:p-8">
        {step < 3 ? <form onSubmit={save}>
          <fieldset disabled={busy} className="space-y-5">
            <legend className="sr-only">{CONNECTION_STEPS[step]}</legend>
            {step === 0 ? <>
              <p>Каким сервисом вы пользуетесь? Сейчас достаточно названия. Доступы проверим отдельно.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {MANAGERS.map((item) => <label key={item.value} className={`flex items-center gap-3 cursor-pointer border p-4 min-h-16 ${draft.manager === item.value ? 'border-asi-gold bg-white' : 'border-asi-border'}`}><input type="radio" name="manager" value={item.value} checked={draft.manager === item.value} onChange={() => patch({ manager: item.value })} required className="h-5 w-5 accent-slate-900" /><span className="text-lg font-semibold">{item.label}</span></label>)}
              </div>
              {draft.manager === 'other' ? <label className="block font-medium">Название сервиса<input className={inputClass} value={draft.otherManager} onChange={(e) => patch({ otherManager: e.target.value })} required maxLength={300} /></label> : null}
              <p className="text-sm text-slate-600">Выбор сервиса пока не подключает его и не меняет ваши календари.</p>
            </> : step === 1 ? <>
              <p>Где вы принимаете бронирования? Можно выбрать несколько вариантов.</p>
              <button type="button" className="underline underline-offset-4" onClick={() => patch({ channels: draft.channels.length === BOOKING_SITES.length ? [] : BOOKING_SITES.map((s) => s.value) })}>{draft.channels.length === BOOKING_SITES.length ? 'Снять все отметки' : 'Выбрать всё'}</button>
              <div className="grid sm:grid-cols-2 gap-3">{BOOKING_SITES.map((site) => <label key={site.value} className="flex items-center gap-3 border border-asi-border p-4 cursor-pointer"><input type="checkbox" checked={draft.channels.includes(site.value)} onChange={(e) => patch({ channels: e.target.checked ? [...draft.channels, site.value] : draft.channels.filter((s) => s !== site.value) })} className="w-5 h-5 accent-slate-900" /><span>{site.label}</span></label>)}</div>
              <p className="text-sm text-slate-600">Мы проверим, как работать с выбранными площадками. Автоматическое подключение всех площадок пока недоступно.</p>
            </> : <>
              <p>Начнём с одного объекта. По этим данным ASI будет отвечать гостям после настройки и проверки.</p>
              {field('name', 'Название объекта')}{field('address', 'Адрес')}{field('description', 'Короткое описание для гостей', { multiline: true })}
              <div className="grid sm:grid-cols-2 gap-5">{field('checkIn', 'Время заезда', { type: 'time' })}{field('checkOut', 'Время выезда', { type: 'time' })}</div>
              {field('rules', 'Правила дома', { multiline: true })}
              <div className="grid sm:grid-cols-2 gap-5">{field('wifiName', 'Название сети Wi-Fi', { optional: true })}{field('wifiPassword', 'Пароль Wi-Fi', { optional: true, type: 'password' })}</div>
              {field('instructions', 'Инструкции для гостей: как попасть в квартиру', { multiline: true })}
              <label className="flex gap-3 items-start"><input type="checkbox" className="w-5 h-5 mt-1 shrink-0" checked={draft.photosLater} onChange={(e) => patch({ photosLater: e.target.checked })} /><span>Фотографии передам позже при проверке объекта</span></label>
              <label className="flex gap-3 items-start"><input type="checkbox" className="w-5 h-5 mt-1 shrink-0" checked={draft.communityMember} onChange={(e) => patch({ communityMember: e.target.checked })} /><span>Я участник закрытой группы Ярослава Стригунова<span className="block mt-1 text-sm text-slate-600">После пилота — 1 000 ₽ за объект в месяц, если решите продолжить. Цена сохраняется на 12 месяцев с перехода на платный режим.</span></span></label>
            </>}
          </fieldset>
          {error ? <p role="alert" className="mt-5 text-red-700">{error}</p> : null}
          <div className="mt-8 flex flex-wrap gap-4 items-center">
            {step > 0 ? <button type="button" disabled={busy} onClick={() => { setError(''); setStep(step - 1); }} className="px-4 py-3 border border-asi-border rounded">← Назад</button> : null}
            <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Сохраняем…' : step === 2 ? 'Сохранить и проверить →' : 'Сохранить и далее →'}</button>
          </div>
          <p className="mt-4 text-sm text-slate-500">После сохранения можно закрыть страницу и продолжить позже.</p>
        </form> : <section aria-labelledby="connection-result">
          <h2 id="connection-result" className="text-2xl font-semibold">Данные объекта сохранены</h2>
          <p className="mt-4 text-lg">{draft.name}</p>
          <p className="mt-2 text-slate-600">{connection.pilotStatus === 'pilot_active' ? 'Пилот запущен. Даты и результаты доступны команде ASI.' : connection.pilotStatus && !['application', 'setup', 'ready'].includes(connection.pilotStatus) ? 'Пилот завершён. Обсудите результаты и дальнейшую работу с ASI.' : 'Следующий шаг — проверка подключений и работы ASI на объекте. 14 бесплатных дней пока не идут.'}</p>
          {connection.readiness ? <ul className="mt-6 divide-y divide-asi-border">{connection.readiness.checks.map((check) => <li key={check.id} className="py-3 flex justify-between gap-4"><span>{check.labelRu}</span><span className={`text-sm shrink-0 ${check.ok ? 'text-emerald-800' : 'text-amber-800'}`}>{check.ok ? 'Заполнено' : 'Нужно проверить'}</span></li>)}</ul> : <p className="mt-5">Проверка данных пока недоступна. Обновите статус чуть позже.</p>}
          <p className="mt-6 border-l-2 border-asi-gold pl-4">{connection.readiness?.ready ? 'Данные для проверки собраны. ASI подтвердит готовность подключений и согласует запуск с вами.' : 'Дополните отмеченные пункты вместе с ASI. Запуск будет согласован с вами после проверки.'}</p>
          {draft.communityMember ? <p className="mt-5 text-sm">Условия закрытой группы Ярослава Стригунова сохранены: настройка 0 ₽, затем 14 дней бесплатно после готовности. Далее — 1 000 ₽ за объект в месяц только по вашему решению, с сохранением цены на 12 месяцев.</p> : null}
          <div className="mt-7 flex flex-wrap gap-4"><button className={buttonClass} onClick={() => void load()}>Обновить статус</button>{(!connection.pilotStatus || ['application', 'setup'].includes(connection.pilotStatus)) ? <button className="px-4 py-3 underline" onClick={() => setStep(2)}>Изменить данные</button> : null}<a className="px-4 py-3 underline" href="/ru/contacts">Связаться с ASI</a></div>
        </section>}
      </div>
    </div>
  );
}

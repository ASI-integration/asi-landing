'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OperationCard, OperationStatus, OperationsSnapshot } from '@/lib/mission-control/operations';
import { OPERATIONS_STALE_MS } from '@/lib/mission-control/operations';
const color: Record<OperationStatus,string> = {
  RUNNING:'text-sky-300 border-sky-400/30 bg-sky-400/10',HOLD:'text-amber-300 border-amber-400/30 bg-amber-400/10',
  DONE:'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',ERROR:'text-red-300 border-red-400/30 bg-red-400/10',
  BLOCKED:'text-orange-300 border-orange-400/30 bg-orange-400/10',UNKNOWN:'text-slate-300 border-slate-500 bg-slate-700/30',STALE:'text-amber-200 border-amber-200/30 bg-amber-200/10',
};
const number = (n: number) => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
const time = (v: string | null) => v ? new Date(v).toLocaleString('ru-RU') : 'Нет подтверждённого времени';
function Meter({label,done,total,bytes=false}:{label:string;done:number|null;total:number|null;bytes?:boolean}) {
  const known = done !== null && total !== null && total > 0;
  const percent = known ? Math.min(100,100*done/total) : null;
  const format = (v:number) => bytes ? `${number(v/1024**3)} ГиБ` : number(v);
  return <div className="space-y-2">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="text-slate-400">{label}</span>
      <span>{known ? `${format(done)} / ${format(total)} · ${number(percent!)}%` : done !== null ? `${format(done)} · общий объём неизвестен` : 'Данные недоступны'}</span></div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? 'Прогресс неизвестен' : `${number(percent)}%`} className="h-2.5 overflow-hidden rounded-full bg-slate-700">
      {percent !== null && <div className="h-full rounded-full bg-sky-400 transition-[width] duration-500" style={{width:`${percent}%`}} />}
    </div>
  </div>;
}
function Card({card,unavailable,now}:{card:OperationCard;unavailable:boolean;now:number}) {
  const transportStale = card.observedAt && now - Date.parse(card.observedAt) > OPERATIONS_STALE_MS;
  const status = card.status === 'HOLD' ? 'HOLD' : unavailable || transportStale ? (card.observedAt ? 'STALE' : 'UNKNOWN') : card.status;
  return <article className="min-w-0 rounded-2xl border border-slate-700/70 bg-[#18263a] p-5 sm:p-6">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-slate-400">{card.product}</p><h2 className="mt-1 text-xl font-semibold">{card.title}</h2></div>
      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${color[status]}`}>{status}</span></div>
    <p className="mb-5 text-sm leading-relaxed text-slate-300">{card.detail}</p>
    <div className="space-y-4">
      {card.id !== 'strigunov-g2' && <Meter label="Файлы / задания" done={card.completed} total={card.total} />}
      {card.id === 'backup-gh' && <Meter label="Объём по отчёту" done={card.bytes} total={card.totalBytes} bytes />}
    </div>
    {card.id === 'runtime-worker' && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-400">Процесс</dt><dd>{card.process === 'PRESENT' ? 'Обнаружен' : card.process === 'ABSENT' ? 'Не обнаружен' : 'Неизвестно'}</dd></div><div><dt className="text-slate-400">Выполнение задания</dt><dd>Не подтверждено</dd></div></dl>}
    {card.errors !== null && <p className="mt-4 text-sm text-slate-300">Ошибки: {number(card.errors)}</p>}
    {card.archives.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer text-sky-300">Подтверждённые SHA-256 ({card.archives.length})</summary><ul className="mt-2 space-y-3">{card.archives.map(a=><li key={a.batch}><span className="text-slate-300">{a.batch} · {number(a.bytes/1024**3)} ГиБ</span><code className="mt-1 block break-all text-xs text-slate-400">{a.sha256}</code></li>)}</ul></details>}
    {card.criteria && <details className="mt-4 text-sm"><summary className="cursor-pointer text-sky-300">Канонические критерии G2</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-slate-300">{card.criteria.map(c=><li key={c}>{c}</li>)}</ul><Link href="/dashboard/strigunov-gps" className="mt-3 inline-block text-sky-300 underline">Открыть маршрут Стригунова 4</Link></details>}
    <div className="mt-5 border-t border-slate-700 pt-4 text-sm"><p className="text-slate-300">{status === 'STALE' ? 'Свежий статус не подтверждён. Показаны последние известные значения.' : card.nextStep}</p><p className="mt-3 text-xs text-slate-400">Подтверждение источника: {time(card.sourceUpdatedAt)}</p>{card.observedAt && <p className="mt-1 text-xs text-slate-400">Последний опрос источника: {time(card.observedAt)}</p>}</div>
  </article>;
}
export default function ProcessesClient() {
  const [snapshot,setSnapshot] = useState<OperationsSnapshot|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [now,setNow] = useState(Date.now());
  useEffect(()=>{
    let stopped=false, timer:ReturnType<typeof setTimeout>, controller:AbortController;
    const refresh=async()=>{
      controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),6000);
      try {
        const response=await fetch('/api/dashboard/development/processes',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        if (!response.ok) throw Error(response.status===401?'Войди в аккаунт владельца.':response.status===403?'Эта панель доступна только владельцу.':'Статусы временно недоступны.');
        const value=await response.json();
        if(value?.ok!==true || value.schemaVersion!=='asi.operations.v1' || !Array.isArray(value.cards)) throw Error('Ответ источника не подтверждён.');
        if(!stopped){setSnapshot(value);setError(null);}
      } catch(e) {if(!stopped){setError(e instanceof Error && e.name!=='AbortError'?e.message:'Источник не ответил вовремя.');}}
      finally {clearTimeout(deadline);if(!stopped)timer=setTimeout(refresh,7000);}
    };
    void refresh();const clock=setInterval(()=>setNow(Date.now()),1000);
    return ()=>{stopped=true;clearTimeout(timer);clearInterval(clock);controller?.abort();};
  },[]);
  return <main className="min-h-[85vh] rounded-2xl bg-[#0d1524] px-4 py-7 text-[#eaf3ff] sm:px-7">
    <div className="mx-auto max-w-6xl"><Link href="/dashboard/development" className="text-sm text-sky-300 hover:underline">← Консоль разработки</Link>
      <div className="mb-6 mt-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-[.2em] text-sky-300">ASI / НАБЛЮДЕНИЕ</p><h1 className="mt-2 text-3xl font-semibold">Панель процессов</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">Все статусы в одном месте. Обновление каждые 7 секунд. Панель не запускает и не останавливает задания.</p></div><Link href="/dashboard/engine-progress" className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Вехи движка →</Link></div>
      <p className="mb-5 text-xs text-slate-400">Последнее получение: {snapshot ? time(snapshot.fetchedAt) : 'ожидаем ответ'}. Время источника указано отдельно в каждой карточке.</p>
      {error && <p role="alert" className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">{error} Сохранённые значения не считаются свежим подтверждением.</p>}
      {!snapshot && !error && <p role="status" className="py-12 text-center text-slate-400">Получаем подтверждённые статусы…</p>}
      <div className="grid gap-5 xl:grid-cols-2">{snapshot?.cards.map(card=><Card key={card.id} card={card} unavailable={!!error} now={now} />)}</div>
      <p className="mt-6 text-xs leading-relaxed text-slate-500">RUNNING не означает DONE. Наличие исполнителя, выполнение задания и подтверждённый результат — разные сведения. HOLD сохраняется до отдельного решения владельца.</p>
    </div>
  </main>;
}

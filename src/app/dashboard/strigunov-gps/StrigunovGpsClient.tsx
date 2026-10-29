'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { acceptedPrefix, physicallyAccepted } from '@/lib/strigunov-gps/acceptance';

type Stage = {
  id: string; title: string; status: string; proofCount: number; acceptance: string[];
};
type Ci = {id: number; name: string; conclusion: string | null; url: string};
type Pr = {
  number: number; state: string; draft: boolean; merged: boolean;
  head: string; ci: Ci[]; ciAvailable: boolean; url: string;
};
type Snapshot = {
  ok: boolean; observedAt: string; mapUrl: string; mapSha: string; staleSnapshot?: boolean;
  issue: {number: number; state: string; updatedAt: string; url: string};
  stages: Stage[]; prs: Pr[]; partialSources?: boolean;
  telemetry: {available: boolean; stale: boolean; status: string;
    stage: string | null; updatedAt: string | null; physicalProof: false};
  serverEvidence: {available: boolean; verifiedStages: string[]; reason: string};
};
const ids = [1, 2, 3, 4, 5, 6].map(n => 'S4-G' + n);
const positions = [[12, 77], [29, 67], [46, 52], [63, 43], [76, 29], [88, 18]];
const fallbackTitles = [
  'Безопасная настройка staging', 'Права оператора и вход',
  'Согласование тестовых данных', 'Тестовая бронь целиком',
  'Операторский экран и защита отправок', 'Независимая приёмка демонстрации',
];
// Display-only translations for the exact G2 acceptance criteria.
// Canonical GitHub wording and verified evidence remain unchanged.
const g2AcceptanceRu: Record<string, string> = {
  'Both effective allowlists and seven no-send flags witnessed':
    'Независимо подтверждены оба действующих списка доступа операторов и все семь запретов отправки сообщений.',
  'Approved human staging operator login demonstrably works':
    'Подтверждён реальный вход уполномоченного оператора в тестовый кабинет через Google.',
};
function A({href, children}: {href: string; children: ReactNode}) {
  return <a href={href} target="_blank" rel="noopener noreferrer"
    className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900">{children}</a>;
}
export default function StrigunovGpsClient() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('S4-G2');
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++seq.current;
    setBusy(true);
    try {
      const res = await fetch('/api/dashboard/strigunov-gps',
        {credentials: 'include', cache: 'no-store'});
      if (res.status === 401) throw new Error('Требуется повторный вход в кабинет.');
      if (res.status === 403) throw new Error('Нет прав владельца для просмотра карты.');
      if (!res.ok) throw new Error('Обновление пока недоступно. Попробуйте ещё раз.');
      const json = await res.json() as Snapshot;
      if (!json.ok || json.stages?.length !== 6) throw new Error('Неожиданный ответ');
      if (ticket === seq.current) { setData(json); setError(''); }
    } catch (cause) {
      if (ticket === seq.current)
        setError(cause instanceof Error ? cause.message : 'Обновление временно недоступно.');
    } finally { if (ticket === seq.current) setBusy(false); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);
  const stages: Stage[] = data?.stages ?? ids.map((id, i) =>
    ({id, title: fallbackTitles[i], status: 'UNKNOWN', proofCount: 0, acceptance: []}));
  const trusted = data?.serverEvidence?.verifiedStages ?? [];
  const count = acceptedPrefix(stages, trusted);
  // The product's current development stage comes from the canonical release map.
  // Independent physical verification is a separate question, not the navigation cursor.
  const current = data ? (stages.find(s => s.status === 'IN_PROGRESS') ??
    stages.find(s => !physicallyAccepted(s, trusted))) : null;
  const canonicalCount = data ? stages.reduce((n, s, i) =>
    n === i && s.status === 'ACCEPTED' ? n + 1 : n, 0) : 0;
  const enginePr = data?.prs.find(p => p.number === 549);
  const g2Pr = data?.prs.find(p => p.number === 550);
  const delegationPr = data?.prs.find(p => p.number === 552);
  const mapPr = data?.prs.find(p => p.number === 537);
  const chosen = stages.find(s => s.id === selected) ?? stages[0];
  const currentIndex = current ? stages.indexOf(current) : -1;
  const ci = data?.prs.flatMap(p => p.ci) ?? [];
  const ciPass = ci.filter(x => x.conclusion === 'success').length;
  const ciFail = ci.filter(x => x.conclusion === 'failure').length;
  const observed = data?.observedAt && Number.isFinite(Date.parse(data.observedAt))
    ? new Date(data.observedAt).toLocaleString('ru-RU') : 'нет';
  // G1 and G2 have known canonical issues. Never fabricate numbers for later stages.
  const issueUrl = selected === 'S4-G1'
    ? 'https://github.com/ASI-integration/asi-landing/issues/511'
    : selected === 'S4-G2'
      ? 'https://github.com/ASI-integration/asi-landing/issues/512' : data?.mapUrl;
  return <main className="mx-auto w-full max-w-[1700px] pb-12 text-slate-900">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950 px-5 py-4 text-white">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-blue-300">ASI · GPS проекта</p>
        <h1 className="mt-1 text-2xl font-black">Карта ASI · Стригунов 4</h1>
        <p className="text-xs text-slate-300">S4-G1 → S4-G6 → READY_FOR_DEMO</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-300">{error || data?.staleSnapshot ? 'Последнее успешное обновление: ' : 'Данные проверены: '}{observed}</span>
        <button type="button" disabled={busy} onClick={() => void load()}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">
          {busy ? 'Проверка…' : 'Обновить'}
        </button>
      </div>
    </header>
    {error && <div role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
      {error} {data ? 'На карте сохранены предыдущие данные. Новые результаты не подтверждены.' : 'Подтверждённого снимка пока нет.'}
    </div>}
    {data?.staleSnapshot && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Обновление GitHub временно недоступно. Отображается предыдущий проверенный снимок; свежих подтверждений нет.
    </div>}
    {data?.partialSources && !data?.staleSnapshot && <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      Карта загружена. Часть дополнительных сведений GitHub временно недоступна и не учитывается как успешная проверка.
    </div>}
    <div className="mb-3 grid gap-2 text-sm md:grid-cols-3">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
        <p className="text-xs font-bold text-blue-700">Продукт · Стригунов</p>
        <p className="mt-1 font-semibold text-slate-900">G1 принят → G2: права и Google-вход</p>
        <p className="mt-1 text-xs text-slate-700">Следующее доказательство: права оператора, семь no-send и проверенный вход.</p>
      </div>
      <div className="rounded-xl border bg-white p-3">
        <p className="text-xs font-bold text-slate-600">Engine · Beget</p>
        <p className="mt-1 font-semibold text-slate-900">Работа 24/7 не подтверждена</p>
        <p className="mt-1 text-xs text-slate-600">{enginePr ? 'Код: PR #549 · ' + (enginePr.merged ? 'объединён' : 'в разработке') : 'Актуальные PR-данные недоступны'}. Нет свидетельства запуска в этом API.</p>
      </div>
      <div className="rounded-xl border bg-white p-3">
        <p className="text-xs font-bold text-slate-600">Разрешения и GPS-публикация</p>
        <p className="mt-1 font-semibold text-slate-900">Делегирование: {delegationPr ? delegationPr.merged ? 'PR объединён, применение не доказано' : 'проект, ещё не введён' : 'не подтверждено'}</p>
        <p className="mt-1 text-xs text-slate-600">Карта: {mapPr ? mapPr.merged ? 'PR объединён; публикацию проверить отдельно' : 'исправления в Draft PR #537' : 'состояние выпуска неизвестно'}.</p>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[230px_minmax(0,1fr)_290px]">
      <aside className="space-y-3">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Вы здесь</p>
          <p className="mt-1 text-3xl font-black text-blue-700">{current?.id ?? 'Нет данных'}</p>
          <p className="mt-1 text-xs text-slate-500">{current ? 'Текущий этап по утверждённой карте' : 'Положение не проверено'}</p>
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs font-semibold text-blue-800">Текущая локальная работа · G2</p>
            <p className="mt-1 text-xs text-blue-900">Права оператора и Google-вход · статус в карте: {stages[1].status}. Прошлые локальные тесты не считаются живой телеметрией или физической приёмкой.</p>
            {g2Pr && <p className="mt-2 text-xs"><A href={g2Pr.url}>G2 · PR #550</A> · {g2Pr.merged ? 'merged' : g2Pr.draft ? 'Draft' : g2Pr.state}</p>}
          </div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Принято по канонической карте</p>
          <p className="mt-1 text-3xl font-black">{data ? canonicalCount : '—'}<span className="text-base font-normal text-slate-500"> / 6</span></p>
          <div className="mt-2 h-2 rounded-full bg-slate-200">
            <div className="h-2 rounded-full bg-emerald-500" style={{width: (canonicalCount / 6 * 100) + '%'}} />
          </div>
          <p className="mt-2 text-xs text-slate-500">Независимо перепроверено в этом запросе: {data ? count : '—'} / 6. При недоступности источника канонический статус не отменяется. PR и CI не являются физической приёмкой.</p>
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <p className="text-xs font-semibold text-indigo-800">Приоритет №1 · Universal Engine</p>
          <p className="mt-1 text-base font-black text-slate-900">{enginePr ? 'PR #549 · ' + (enginePr.merged ? 'merged' : enginePr.draft ? 'Draft' : enginePr.state) : 'Данные PR недоступны'}</p>
          <p className="mt-1 font-mono text-xs text-slate-500">{enginePr?.head.slice(0, 12) ?? 'HEAD не проверен'}</p>
          <p className="mt-2 text-xs text-indigo-900">Работающий серверный Engine 24/7 этим API не подтверждается. Код/CI и физический запуск — разные состояния.</p>
          <div className="mt-2 text-xs"><A href="https://github.com/ASI-integration/asi-landing/pull/549">Ход работ над Engine · PR #549</A></div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-800">Подготовка в GitHub</p>
          <p className="mt-2 text-lg font-black">{data ? data.prs.length + ' PR' : 'Не проверено'}</p>
          <p className="mt-1 text-xs text-amber-800">Проверки GitHub: {ciPass} PASS / {ciFail} FAIL среди доступных записей. Это не выполнение задач и не физическая приёмка.</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs font-semibold text-rose-700">Ближайшее препятствие</p>
          <p className="mt-1 text-sm font-bold">
            {canonicalCount === 6 ? 'Маршрут формально завершён — перепроверь свидетельства' :
              current ? 'Физическая приёмка ' + current.id + ' ещё не подтверждена' : 'Нужны данные канонического маршрута'}
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs font-semibold text-slate-500">Телеметрия · не физическая приёмка</p>
          <p className="mt-1 text-sm font-bold">{data?.telemetry?.available
            ? data.telemetry.status : 'Недоступен или устарел'}</p>
          <p className="mt-1 text-xs text-slate-500">
            {data?.telemetry?.available ? data.telemetry.stage : 'Нет свежей телеметрии'}
          </p>
          <p className="mt-2 text-xs text-slate-500">Целевой сервер G2: Beget. Источник показанного сигнала — Mission Control, обновлён {data?.telemetry?.updatedAt ? new Date(data.telemetry.updatedAt).toLocaleString('ru-RU') : 'неизвестно'}. Этот сигнал не является проверкой Beget, запуском Engine или физической приёмкой G2. Отсутствие сигнала не доказывает остановку задач.</p>
        </div>
      </aside>

      <section className="min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="relative h-[580px] overflow-hidden bg-[#e9eee5]" aria-label="Интерактивная карта этапов проекта">
          <div className="absolute left-3 top-3 z-20 flex flex-wrap gap-2 rounded-lg bg-white/95 p-2 text-xs font-semibold shadow">
            <span className="text-emerald-700">● Принято</span>
            <span className="text-blue-700">● Текущий этап</span>
            <span className="text-rose-700">● Препятствие</span>
            <span className="text-slate-500">● Далее</span>
          </div>
          <div className="absolute right-3 top-3 z-20 flex flex-col gap-2">
            <button type="button" aria-label="Увеличить" onClick={() => setZoom(z => Math.min(1.8, z + 0.15))}
              className="h-10 w-10 rounded-lg bg-white text-xl shadow">+</button>
            <button type="button" aria-label="Уменьшить" onClick={() => setZoom(z => Math.max(1, z - 0.15))}
              className="h-10 w-10 rounded-lg bg-white text-xl shadow">−</button>
            <button type="button" aria-label="Сбросить масштаб" onClick={() => setZoom(1)}
              className="h-10 w-10 rounded-lg bg-white text-xs font-bold shadow">1:1</button>
          </div>
          <div className="absolute inset-0 origin-[23%_74%] transition-transform duration-200"
            style={{transform: 'scale(' + zoom + ')'}}>
            <svg aria-hidden="true" className="absolute inset-0 h-full w-full"
              viewBox="0 0 1000 580" preserveAspectRatio="none">
              <rect width="1000" height="580" fill="#e8eee3"/>
              <path d="M0 0H350L310 110 400 150 245 330 0 255Z M650 0H1000V160L800 140 710 200Z M0 420Q180 340 300 450L430 580H0Z M590 580Q660 440 800 420L1000 340V580Z" fill="#bcd7ae"/>
              <path d="M80 50l170 30-45 85-165-20z M480 20l160 25-44 100-160-10z M725 255l185-40 55 80-130 65z" fill="#d1e4c5"/>
              <path d="M-30 295Q190 250 300 318T565 300T1000 50" fill="none" stroke="#97cce4" strokeWidth="29"/>
              <path d="M-30 295Q190 250 300 318T565 300T1000 50" fill="none" stroke="#d6eef8" strokeWidth="16"/>
              <path d="M-50 500Q240 310 390 390T1040 100 M90 -40Q330 180 1010 450 M-20 125Q205 140 370 235T1030 340"
                fill="none" stroke="#fff" strokeWidth="12"/>
              <path d="M-50 500Q240 310 390 390T1040 100 M90 -40Q330 180 1010 450 M-20 125Q205 140 370 235T1030 340"
                fill="none" stroke="#cbd5cd" strokeWidth="2"/>
              <path d="M-20 170Q230 240 430 150T1010 22 M130 590Q400 385 610 452T1010 360"
                fill="none" stroke="#ecc075" strokeWidth="9"/>
              <path d="M-20 170Q230 240 430 150T1010 22 M130 590Q400 385 610 452T1010 360"
                fill="none" stroke="#fff2cf" strokeWidth="3"/>
              <g fill="#819783" fontSize="17" fontWeight="500">
                <text x="135" y="90">Лес задач</text>
                <text x="640" y="520">Поле испытаний</text><text x="775" y="105">Демо-город</text>
              </g>
              {/* A tiny grass blade replaces the former oversized "Valley of checks". */}
              <g aria-hidden="true" stroke="#6d9566" strokeWidth="1.5" fill="none" strokeLinecap="round">
                <path d="M482 125q-2-10-1-19 M482 125q-7-6-10-11 M482 125q6-11 10-15"/>
              </g>
              <text x="497" y="121" fill="#819783" fontSize="10">Проверки</text>
              <path d="M120 447C195 440 230 405 290 389S415 344 460 302S585 265 630 250S720 212 760 174S840 135 880 105"
                fill="none" stroke="#fff" strokeWidth="15" strokeLinecap="round"/>
              <path d="M120 447C195 440 230 405 290 389S415 344 460 302S585 265 630 250S720 212 760 174S840 135 880 105"
                fill="none" stroke="#64748b" strokeWidth="8" strokeDasharray="13 11" strokeLinecap="round"/>
            </svg>
            {stages.map((stage, index) => {
              const done = physicallyAccepted(stage, trusted);
              const acceptedByMap = stage.status === 'ACCEPTED';
              const active = stage.id === current?.id;
              const [x, y] = positions[index];
              return <button type="button" key={stage.id}
                onClick={() => setSelected(stage.id)}
                aria-pressed={selected === stage.id}
                style={{left: x + '%', top: y + '%'}}
                className={'absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 px-3 py-2 text-sm font-black shadow-lg hover:scale-105 ' +
                  (selected === stage.id ? 'ring-4 ring-blue-200 ' : '') +
                  (done ? 'border-emerald-700 bg-emerald-600 text-white' :
                    acceptedByMap ? 'border-amber-700 bg-amber-100 text-amber-900' :
                    active ? 'border-blue-800 bg-blue-600 text-white' :
                    'border-slate-400 bg-white text-slate-700')}>
                {done ? '✓ ' : acceptedByMap ? '◇ ' : active ? '◎ ' : '🔒 '}{stage.id}
                {active && <span className="block text-[10px]">ПРИЁМКА</span>}
              </button>;
            })}
            {currentIndex >= 0 && <span className="absolute z-10 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow"
              style={{left: Math.min(86, positions[currentIndex][0] + 6) + '%',
                top: Math.max(10, positions[currentIndex][1] - 11) + '%'}}>
              Для {current?.id} ещё нужны доказательства приёмки
            </span>}
            <div className="absolute right-[3%] top-[6%] rounded-xl border-2 border-red-500 bg-white p-2 text-xs font-black shadow">
              ⌖ READY_FOR_DEMO
            </div>
          </div>
          <div className="absolute bottom-3 left-3 rounded-lg bg-white/95 p-2 text-xs text-slate-600 shadow">
            Карта приёмки · локальная разработка G2 отображается отдельно
          </div>
        </div>
        <div className="border-t p-4">
          <p className="text-xs font-bold text-blue-700">Выбранный пункт: {chosen.id}</p>
          <h2 className="mt-1 text-lg font-black">{chosen.id === 'S4-G2' ? 'Права оператора и вход в кабинет' : chosen.title}</h2>
          <p className="mt-1 text-xs text-slate-600">
            Статус: {chosen.status} · доказательств в карте: {chosen.proofCount} ·
            физическая приёмка: {physicallyAccepted(chosen, trusted) ? 'подтверждена' : 'не подтверждена'}
          </p>
          <details key={selected} className="mt-3 rounded-xl bg-slate-50 p-3" open={selected === 'S4-G1' || selected === 'S4-G2'}>
            <summary className="cursor-pointer text-sm font-bold">Условия завершения ({chosen.acceptance.length})</summary>
            <div className="mt-2 space-y-2">
              {chosen.acceptance.map((item, i) =>
                <p className="text-xs leading-5 text-slate-700" key={i}>□ {chosen.id === 'S4-G2' ? (g2AcceptanceRu[item] ?? item) : item}</p>)}
              {!chosen.acceptance.length && <p className="text-xs">Ожидаем сведения из канонической карты.</p>}
            </div>
          </details>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {issueUrl && <A href={issueUrl}>{selected === 'S4-G1' ? 'Issue #511' : selected === 'S4-G2' ? 'Issue #512' : 'Каноническая карта'}</A>}
            {data && <A href={data.mapUrl}>Каноническая карта</A>}
          </div>
        </div>
      </section>

      <aside className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black">Факты и доказательства</h2>
        <p className="text-xs text-slate-500">Источник: GitHub, текущие PR и CI на точных SHA</p>
        {!data && <p className="text-sm text-amber-700">Нет подтверждённого снимка GitHub.</p>}
        {data && <>
          <div className="rounded-xl border p-3 text-sm">
            <A href={data.mapUrl}>Канонический релиз</A>
            <p className="mt-1 font-mono text-xs text-slate-500">{data.mapSha.slice(0, 12)}</p>
          </div>
          <div className="rounded-xl border p-3 text-sm">
            <A href={data.issue.url}>Issue #511</A> · {data.issue.state}
          </div>
          {data.prs.map(pr => <div key={pr.number} className="rounded-xl border p-3 text-sm">
            <div className="flex justify-between gap-2">
              <A href={pr.url}>PR #{pr.number}</A>
              <span className="text-xs text-slate-600">{pr.draft ? 'Draft' : pr.merged ? 'Merged' : pr.state}</span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-500">{pr.head.slice(0, 12)}</p>
            {!pr.ciAvailable && <p className="mt-2 text-xs text-amber-700">CI: нет доступа к данным</p>}
            {pr.ci.map(run => <p className="mt-1 flex flex-wrap justify-between gap-2 text-xs" key={run.id}>
              <A href={run.url}>{run.name}</A>
              <span className={run.conclusion === 'success' ? 'text-emerald-700' : 'text-rose-700'}>
                {run.conclusion ?? 'unknown'}
              </span>
            </p>)}
          </div>)}
          <div className={'rounded-xl border p-3 ' + (data.serverEvidence.available ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
            <p className="text-sm font-bold text-slate-900">Независимая физическая проверка G1</p>
            <p className="mt-1 text-xs text-slate-700">{data.serverEvidence.reason}</p>
            <p className="mt-2 text-xs font-semibold text-amber-800">G2: физическая приёмка не подтверждена. Результаты CI не заменяют её.</p>
          </div>
        </>}
      </aside>
    </div>
    <p className="mt-3 text-xs text-slate-500">
      Автоматическое чтение канонической карты каждые 30 секунд. Локальные тесты G2 с диска H: не считываются в реальном времени и не доказывают серверную приёмку. Только чтение; без PR, merge, запуска Engine и изменений серверов.
      Факты обновляются раздельно: канонический статус, независимо подтверждённые свидетельства и серверная телеметрия. CI не заменяет физическую приёмку.
    </p>
  </main>;
}

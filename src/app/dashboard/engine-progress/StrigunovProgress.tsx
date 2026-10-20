'use client';

import { useEffect, useState } from 'react';
import { PILOT_STAGES, type CheckState, type PilotSnapshot } from '@/lib/engine-progress/strigunov-types';

const LABELS: Record<CheckState, string> = { success: 'PASS', failed: 'FAIL', pending: 'Выполняется',
  missing: 'Нет результата', skipped: 'Пропущено', unknown: 'Не подтверждено' };
const STAGE_LABELS: Record<string, string> = { ACCEPTED: 'Принят по карте', IN_PROGRESS: 'В работе',
  NOT_STARTED: 'Впереди', BLOCKED: 'Заблокирован' };

/** Route geometry conveys sequence only: no time, effort or readiness percentage. */
export function PilotRouteView({ snapshot }: { snapshot: PilotSnapshot }) {
  const route = snapshot.route;
  const current = route?.stages.findIndex(s => s.status !== 'ACCEPTED') ?? -1;
  const remaining = route?.stages.filter(s => s.status !== 'ACCEPTED').length;
  const governance = snapshot.prs.find(p => p.number === 510);
  const ready = governance?.available && snapshot.requiredKnown && governance.review === 'success' &&
    governance.checks.filter(c => c.required).length > 0 && governance.checks.filter(c => c.required).every(c => c.state === 'success');
  const next = !snapshot.available ? 'Восстановить чтение источников; текущий допуск не подтверждён.'
    : governance?.state === 'open' ? ready ? 'Подготовить владельцу решение о merge #510. Панель не выдаёт разрешение.'
      : 'Завершить проверки и обзор текущего HEAD #510.'
    : governance?.state !== 'merged' ? 'Уточнить решение по #510: PR закрыт без merge.'
    : current === 0 ? 'Подготовить и независимо проверить безопасное применение ремонта S4-G1.'
    : 'Сверить доказательства текущего этапа и отдельное решение владельца перед следующим действием.';
  const blocker = !route ? 'Карта релиза недоступна; положение на маршруте не подтверждено.'
    : current === 0 ? 'Для ремонта нужны доказанная изоляция общего systemd reload и защищённый адаптер применения. Состояние сервера эта панель не проверяет.'
    : 'Переход требует физического свидетельства и решения владельца; статусы кода не заменяют приёмку.';
  return <>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl bg-teal-50 p-4"><p className="text-xs font-bold text-teal-800">ГДЕ МЫ</p>
        <p className="mt-2 font-bold">{!route ? 'Нет подтверждённой карты' : current < 0 ? 'Все этапы отмечены принятыми в карте' : `S4-G${current + 1} · ${PILOT_STAGES[current]}`}</p></div>
      <div className="rounded-2xl bg-slate-100 p-4"><p className="text-xs font-bold text-slate-600">ОСТАЛОСЬ ПО КАРТЕ</p>
        <p className="mt-2 text-2xl font-black">{remaining ?? '—'} <span className="text-base font-medium">из 6 этапов</span></p>
        <p className="mt-1 text-xs text-slate-600">Число отдельных заданий заранее не определено.</p></div>
      <div className="rounded-2xl bg-slate-900 p-4 text-white"><p className="text-xs font-bold text-teal-300">КУДА ИДЁМ</p>
        <p className="mt-2 font-bold">Работающий пилот Стригунова, принятый владельцем</p></div>
    </div>
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <svg viewBox="0 0 960 300" className="min-w-[620px] w-full" role="img" aria-label="Маршрут от подготовки к приёмке: шесть последовательных этапов, не процент готовности">
        <path d="M 40 250 Q 480 250 920 40" fill="none" stroke="#94a3b8" strokeWidth="4" />
        <circle cx="40" cy="250" r="7" fill="#475569" /><text x="40" y="278" fontSize="14">Старт</text>
        {PILOT_STAGES.map((title, i) => {
          const t = (i + 1) / 6, x = 40 + 880 * t, y = 250 - 210 * t * t;
          const accepted = route?.stages[i].status === 'ACCEPTED';
          return <g key={title}>
            <title>{`S4-G${i + 1}: ${title}${current === i ? ' — сейчас' : ''}`}</title>
            {current === i && <circle cx={x} cy={y} r="20" fill="#ccfbf1" />}
            <circle cx={x} cy={y} r="10" fill={current === i ? '#0f766e' : accepted ? '#047857' : '#64748b'} />
            <text x={x} y={y + 32} textAnchor="middle" fontSize="15" fontWeight="700">{`S4-G${i + 1}`}</text>
            {current === i && <text x={x} y={y - 28} textAnchor="middle" fontSize="14" fill="#0f766e">Мы здесь</text>}
          </g>;
        })}
      </svg>
    </div>
    <p className="text-xs text-slate-600">Старт — подготовка исходников и защищённой квитанции. Кривая показывает порядок движения, а не процент готовности, длительность или одинаковую сложность этапов.</p>
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {PILOT_STAGES.map((title, i) => <li key={title} aria-current={current === i ? 'step' : undefined}
        className={`rounded-xl border p-3 text-sm ${current === i ? 'border-teal-600 bg-teal-50' : 'border-slate-200'}`}>
        <strong>{`S4-G${i + 1} · ${title}`}</strong>
        <p className="mt-1 text-xs text-slate-600">{route ? STAGE_LABELS[route.stages[i].status] : 'Нет данных'}</p>
      </li>)}
    </ol>
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-teal-200 p-4"><h3 className="font-bold">Следующий безопасный шаг</h3><p className="mt-2 text-sm">{next}</p></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-bold">Что ограничивает переход</h3><p className="mt-2 text-sm">{blocker}</p></div>
    </div>
    {route && <p className="break-all text-xs text-slate-500">Источник: {route.source === 'main' ? 'карта из main' : 'проект карты из PR #510, ещё не принят в main'} · SHA {route.sha}. Статусы карты не являются новой независимой проверкой физической приёмки.</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      {snapshot.prs.map(pr => <section key={pr.number} className="min-w-0 rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold"><a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">PR #{pr.number}</a>
          <span className="ml-2 text-sm font-normal">{pr.state === 'open' ? 'Открыт' : pr.state === 'merged' ? 'Объединён' : pr.state === 'closed' ? 'Закрыт' : 'Нет данных'}</span></h3>
        <p className="mt-2 text-xs text-slate-500">Точный HEAD</p><code className="block break-all text-xs">{pr.head ?? 'Не подтверждён'}</code>
        {!pr.available && <p className="mt-2 text-sm text-amber-800">Источник недоступен. Прошлый PASS не используется.</p>}
        <ul className="mt-3 space-y-2 text-sm">{pr.checks.map(c => <li key={c.name} className="flex flex-wrap justify-between gap-2">
          <span>{c.name}<small className="block text-slate-500">{!snapshot.requiredKnown ? 'Обязательность не подтверждена' : c.required ? 'Обязательная проверка main' : 'Дополнительная проверка'}</small></span><strong>{LABELS[c.state]}</strong>
        </li>)}</ul>
        <p className="mt-3 border-t pt-3 text-sm">CodeRabbit на этом HEAD: <strong>{pr.review === 'success' ? 'Обзор завершён' : LABELS[pr.review]}</strong></p>
      </section>)}
    </div>
  </>;
}

export default function StrigunovProgress() {
  const [snapshot, setSnapshot] = useState<PilotSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false, active: AbortController | null = null;
    async function load() {
      if (active) return;
      const controller = new AbortController(); active = controller;
      const timeout = window.setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch('/api/dashboard/engine-progress?view=strigunov4', {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json() as PilotSnapshot & { ok?: boolean };
        if (!data.ok || !Array.isArray(data.prs)) throw new Error('Incomplete');
        if (!stopped) { setSnapshot(data); setFailed(false); }
      } catch { if (!stopped) { setSnapshot(null); setFailed(true); } }
      finally { window.clearTimeout(timeout); active = null; }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20000);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus);
    return () => { stopped = true; active?.abort(); window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, []);
  return <section id="strigunov4" className="mx-auto mb-8 max-w-6xl space-y-5 rounded-3xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm sm:p-7">
    <header><p className="text-xs font-bold tracking-widest text-teal-700">ПИЛОТ ASI</p><h1 className="mt-2 text-3xl font-black">Стригунов 4 · маршрут к запуску</h1>
      <p className="mt-2 text-sm text-slate-600">Обновление каждые 20 секунд · только чтение · {snapshot ? `снимок ${new Date(snapshot.checkedAt).toLocaleTimeString('ru-RU')}` : 'ожидание источника'}</p></header>
    {failed && <p role="alert" className="text-amber-800">Обновление не удалось. Текущие статусы не подтверждены.</p>}
    {snapshot ? <PilotRouteView snapshot={snapshot} /> : !failed && <p>Загружаю текущую карту и проверки…</p>}
    <p className="text-xs text-slate-500">Эта страница не запускает операции и не заменяет разрешение владельца на объединение кода или работу с сервером.</p>
  </section>;
}

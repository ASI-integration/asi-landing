'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { catalogRows } from '@/lib/owner-console/catalog';
import {
  ownerCommercialOffer,
  ownerConsoleSearch,
  resolveOwnerConsoleContext,
  type OwnerLang,
  type OwnerVertical,
} from '@/lib/owner-console/context';
import type { DemoAuditEntry, DemoSnapshot } from '@/lib/owner-console/demo-run';

const SECTIONS = ['main', 'properties', 'operations', 'audit', 'plan'] as const;
type Section = (typeof SECTIONS)[number];

const VERTICALS: OwnerVertical[] = ['hospitality', 'real_estate', 'industrial', 'marketplaces'];

function isSection(value: string | null): value is Section {
  return (SECTIONS as readonly string[]).includes(value ?? '');
}

export function OwnerConsole({ hostname }: { hostname: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const langQuery = searchParams.get('lang');
  const verticalQuery = searchParams.get('vertical');
  const sectionQuery = searchParams.get('section');
  const section: Section = isSection(sectionQuery) ? sectionQuery : 'main';
  const context = useMemo(
    () => resolveOwnerConsoleContext({ hostname, lang: langQuery, vertical: verticalQuery }),
    [hostname, langQuery, verticalQuery],
  );
  const copy = context.lang === 'ru' ? RU : EN;
  const offer = useMemo(() => ownerCommercialOffer(context.market, context.lang), [context.market, context.lang]);
  const [run, setRun] = useState<DemoSnapshot | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { if (!controller.signal.aborted) setSignedIn(Boolean(value?.user?.id)); })
      .catch(() => { if (!controller.signal.aborted) setSignedIn(null); });
    return () => controller.abort();
  }, []);
  const accountDestination = context.market === 'ru' ? '/ru/legal-onboarding' : '/dashboard';
  const signupDestination = context.market === 'ru'
    ? '/ru/connect?redirect=%2Fru%2Flegal-onboarding'
    : '/connect?redirect=%2Fdashboard';
  const loginDestination = context.market === 'ru'
    ? '/ru/connect?redirect=%2Fru%2Flegal-onboarding'
    : '/login?redirect=%2Fdashboard';
  const [audits, setAudits] = useState<DemoAuditEntry[]>([]);

  function go(next: { lang?: OwnerLang; vertical?: OwnerVertical | null; section?: Section }) {
    const lang = next.lang ?? context.lang;
    const vertical = next.vertical === undefined ? context.vertical : next.vertical;
    const target = next.section ?? section;
    const query = ownerConsoleSearch({ lang, vertical }, target);
    router.replace(`/owner?${query}`);
  }

  async function launchDemo() {
    if (running) return;
    setRunning(true);
    setRunError(null);
    setRun(null);
    try {
      const created = await fetch('/api/owner/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'hospitality-checkout', lang: context.lang }),
      });
      const payload = (await created.json()) as DemoSnapshot | { ok: false };
      if (!created.ok || !payload.ok) throw new Error('sandbox');
      setRun(payload);
      let current = payload;
      while (!current.done) {
        await wait(450);
        const next = await fetch(`/api/owner/demo?runId=${encodeURIComponent(current.runId)}`, { cache: 'no-store' });
        const snap = (await next.json()) as DemoSnapshot | { ok: false };
        if (!next.ok || !snap.ok) throw new Error('sandbox');
        current = snap;
        setRun(snap);
      }
      if (current.audit) {
        setAudits((prev) => [current.audit!, ...prev.filter((item) => item.id !== current.audit!.id)]);
      }
    } catch {
      setRunError(copy.demoError);
    } finally {
      setRunning(false);
    }
  }

  const rows = catalogRows(section === 'operations' ? 'tasks' : 'properties', context.lang, context.vertical);
  const verticalLabel = context.vertical ? copy.verticals[context.vertical] : copy.platform;

  return (
    <div className="min-h-dvh bg-asi-ivory text-asi-navy font-sans">
      <header className="sticky top-0 z-40 border-b border-asi-border bg-asi-ivory/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <button type="button" onClick={() => go({ section: 'main' })} className="text-left">
            <span className="block font-serif text-2xl tracking-tight">ASI Global</span>
            <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-asi-gold-text">
              {copy.console} · {verticalLabel}
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-3">
            {context.showVerticalSwitcher ? (
              <div className="flex flex-wrap gap-1" role="group" aria-label={copy.verticalLabel}>
                {VERTICALS.map((vertical) => {
                  const active = context.vertical === vertical;
                  return (
                    <button
                      key={vertical}
                      type="button"
                      aria-pressed={active}
                      onClick={() => go({ vertical })}
                      className={`px-3 py-1.5 text-xs uppercase tracking-[0.12em] border ${
                        active ? 'border-asi-navy bg-asi-navy text-asi-ivory' : 'border-asi-border text-asi-navy/70 hover:text-asi-navy'
                      }`}
                    >
                      {copy.verticals[vertical]}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="flex border border-asi-border" role="group" aria-label={copy.languageLabel}>
              {(['en', 'ru'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  aria-pressed={context.lang === lang}
                  onClick={() => go({ lang })}
                  className={`px-3 py-1.5 text-xs uppercase tracking-[0.14em] ${
                    context.lang === lang ? 'bg-asi-navy text-asi-ivory' : 'text-asi-navy/70'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-5 pb-3 sm:px-8" aria-label={copy.navLabel}>
          {(['properties', 'operations', 'audit', 'plan'] as const).map((item) => {
            const active = section === item;
            return (
              <button
                key={item}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => go({ section: item })}
                className={`shrink-0 border-b-2 px-1 py-2 text-sm ${
                  active ? 'border-asi-gold text-asi-navy' : 'border-transparent text-asi-navy/65 hover:text-asi-navy'
                }`}
              >
                {copy.nav[item]}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        {section === 'main' ? (
          <section aria-label={copy.accountLabel} className="mb-8 flex flex-wrap items-center justify-between gap-4 border border-asi-border bg-asi-paper p-5">
            <div>
              <p className="font-serif text-2xl">{copy.accountLabel}</p>
              <p className="mt-1 text-sm text-asi-navy/70">
                {signedIn === true ? copy.accountSignedIn : copy.accountPrompt}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {signedIn === true ? (
                <a href={accountDestination} className="bg-asi-navy px-5 py-3 text-sm font-semibold text-asi-ivory hover:bg-asi-navy-2">
                  {copy.accountContinue}
                </a>
              ) : (
                <>
                  <a href={loginDestination} className="border border-asi-navy px-5 py-3 text-sm font-semibold text-asi-navy hover:bg-asi-ivory">
                    {copy.accountLogin}
                  </a>
                  <a href={signupDestination} className="bg-asi-navy px-5 py-3 text-sm font-semibold text-asi-ivory hover:bg-asi-navy-2">
                    {copy.accountCreate}
                  </a>
                </>
              )}
            </div>
          </section>
        ) : null}
        {section === 'main' ? (
          <div className="grid gap-8 lg:grid-cols-[1.15fr,0.85fr]">
            <section className="border border-asi-border bg-asi-paper p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">{copy.demoKicker}</p>
              <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">{copy.demoTitle}</h1>
              <p className="mt-4 max-w-xl text-asi-navy/75 leading-relaxed">{copy.demoBody}</p>
              <button
                type="button"
                onClick={() => void launchDemo()}
                disabled={running}
                className="mt-6 inline-flex items-center bg-asi-navy px-5 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-asi-ivory hover:bg-asi-navy-2 disabled:opacity-60"
              >
                {running ? copy.demoRunning : copy.demoButton}
              </button>
              {runError ? <p className="mt-4 text-sm text-asi-navy">{runError}</p> : null}
              <p className="mt-4 text-xs uppercase tracking-[0.16em] text-asi-navy/50">{copy.demoFoot}</p>
            </section>
            <section className="bg-asi-navy p-6 text-asi-ivory sm:p-8" aria-live="polite">
              <p className="text-xs uppercase tracking-[0.18em] text-asi-gold-soft">{copy.stepsTitle}</p>
              <ol className="mt-6 space-y-5">
                {(run?.steps ?? idleSteps(context.lang)).map((step, index) => (
                  <li key={step.id} className="border-t border-asi-ivory/15 pt-4">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-serif text-xl">{step.title}</span>
                      <span className="text-xs uppercase tracking-[0.14em] text-asi-gold-soft">
                        {step.state === 'pending' && !run ? String(index + 1).padStart(2, '0') : copy.stepState[step.state]}
                      </span>
                    </div>
                    {step.detail ? <p className="mt-2 text-sm text-asi-ivory/75">{step.detail}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        ) : null}

        {section === 'properties' || section === 'operations' ? (
          <section>
            <h1 className="font-serif text-4xl">{copy.nav[section]}</h1>
            <p className="mt-3 max-w-2xl text-asi-navy/70">{copy.sectionLead[section]}</p>
            <ul className="mt-8 divide-y divide-asi-border border-y border-asi-border">
              {rows.map((row) => (
                <li key={row.title} className="flex flex-wrap items-baseline justify-between gap-3 py-4">
                  <div>
                    <p className="font-serif text-2xl">{row.title}</p>
                    <p className="mt-1 text-sm text-asi-navy/65">{row.meta}</p>
                  </div>
                  <span className="text-xs uppercase tracking-[0.16em] text-asi-gold-text">{row.status}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {section === 'audit' ? (
          <section>
            <h1 className="font-serif text-4xl">{copy.nav.audit}</h1>
            <p className="mt-3 max-w-2xl text-asi-navy/70">{copy.sectionLead.audit}</p>
            <ul className="mt-8 space-y-4">
              {audits.length === 0 ? <li className="border border-asi-border bg-asi-paper p-5 text-asi-navy/70">{copy.auditEmpty}</li> : null}
              {audits.map((entry) => (
                <li key={entry.id} className="border border-asi-border bg-asi-paper p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className="font-serif text-2xl">{entry.title}</h2>
                    <span className="text-xs uppercase tracking-[0.16em] text-asi-gold-text">{copy.immutable}</span>
                  </div>
                  <p className="mt-2 text-sm text-asi-navy/70">{entry.summary}</p>
                  <p className="mt-3 font-serif text-3xl">
                    {entry.total} {entry.currency}
                  </p>
                  <ul className="mt-3 text-sm text-asi-navy/70">
                    {entry.lines.map((line) => (
                      <li key={line.label}>
                        {line.label} — {line.amount} {entry.currency}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {section === 'plan' ? (
          <section>
            <h1 className="font-serif text-4xl">{copy.nav.plan}</h1>
            <div className="mt-8 grid gap-px border border-asi-border bg-asi-border sm:grid-cols-2 lg:grid-cols-4">
              {copy.plan.map((item) => (
                <div key={item.label} className="bg-asi-paper p-6">
                  <p className="text-xs uppercase tracking-[0.16em] text-asi-gold-text">{item.label}</p>
                  <p className="mt-3 font-serif text-3xl">{item.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-2xl text-sm text-asi-navy/65">{copy.planNote}</p>
          </section>
        ) : null}

        {(section === 'main' || section === 'plan') ? (
          <section aria-label={copy.commercialLabel} className="mt-10 border border-asi-border bg-asi-paper p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">{copy.commercialLabel}</p>
            <h2 className="mt-3 font-serif text-3xl leading-tight sm:text-4xl">{offer.heading}</h2>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-asi-navy/75 sm:text-base">{offer.intro}</p>
            <dl className="mt-6 grid gap-px border border-asi-border bg-asi-border sm:grid-cols-2 lg:grid-cols-4">
              {offer.facts.map((fact) => (
                <div key={fact.label} className="bg-asi-ivory p-5">
                  <dt className="text-xs uppercase tracking-[0.14em] text-asi-gold-text">{fact.label}</dt>
                  <dd className="mt-2 font-serif text-2xl">{fact.value}</dd>
                  <p className="mt-2 text-sm leading-relaxed text-asi-navy/65">{fact.detail}</p>
                </div>
              ))}
            </dl>
            <p className="mt-5 max-w-3xl text-sm leading-relaxed text-asi-navy/75">{offer.note}</p>
            <a
              href={offer.ctaHref}
              className="mt-6 inline-flex items-center bg-asi-navy px-5 py-3 text-sm font-semibold text-asi-ivory hover:bg-asi-navy-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-asi-gold"
            >
              {offer.ctaLabel}
            </a>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function idleSteps(lang: OwnerLang): DemoSnapshot['steps'] {
  const titles = lang === 'ru'
    ? [
        'Событие получено (выезд гостя)',
        'Состояние проверено',
        'Горничная и чек-лист назначены',
        'Себестоимость и неизменяемая запись аудита сохранены',
      ]
    : [
        'Event Received (Guest Checkout)',
        'Condition Verified',
        'Housekeeping & Checklist Auto-Assigned',
        'Operation Cost & Immutable Audit Entry Logged',
      ];
  const ids = ['received', 'verified', 'assigned', 'logged'] as const;
  return ids.map((id, index) => ({ id, state: 'pending' as const, title: titles[index], detail: '' }));
}

const EN = {
  accountLabel: 'Your ASI account',
  accountPrompt: 'One account for real onboarding; the public demo is separate and never starts billing.',
  accountSignedIn: 'Signed in. Continue to your workspace.',
  accountContinue: 'Go to workspace',
  accountLogin: 'Sign in',
  accountCreate: 'Create account',
  demoTitle: 'Interactive Live Demo',
  commercialLabel: 'Commercial terms',
  console: 'Owner Console',
  platform: 'Platform',
  verticalLabel: 'Vertical',
  languageLabel: 'Language',
  navLabel: 'Owner console',
  demoKicker: '7-day demo · 0 paid LLM tokens',
  demoBody: 'One hospitality pass: guest checkout, room check, housekeeping assignment, then cost and an audit entry. The sandbox never calls a paid model.',
  demoButton: 'Run 60-Sec Live Demo',
  demoRunning: 'Running…',
  demoFoot: 'Sandbox only · tokens billed: 0',
  demoError: 'The sandbox did not start. Try again.',
  stepsTitle: 'Live steps',
  auditEmpty: 'No demo entry yet. Run the live demo on the main screen.',
  immutable: 'Immutable',
  verticals: {
    hospitality: 'Hospitality',
    real_estate: 'Real Estate',
    industrial: 'Industrial',
    marketplaces: 'Marketplaces',
  },
  nav: {
    properties: 'Properties',
    operations: 'Tasks & Staff',
    audit: 'Audit Log',
    plan: 'Plan & Usage',
  },
  sectionLead: {
    properties: 'Objects in the active vertical. Figures are demo fixtures.',
    operations: 'Open work and the people assigned to it.',
    audit: 'Entries written by the sandbox stay fixed for this session.',
  },
  stepState: { pending: 'Waiting', active: 'In progress', done: 'Done' },
  plan: [
    { label: 'Plan', value: '7-day Demo' },
    { label: 'Demo price', value: '0' },
    { label: 'Paid LLM', value: '0' },
    { label: 'Demo window', value: '7 days' },
  ],
  planNote: 'The demo window is a sandbox with example objects and five staff slots. It is not a property pilot or a paid subscription and never calls paid models.',
};

const RU = {
  accountLabel: 'Ваш кабинет ASI',
  accountPrompt: 'Одна учётная запись для подключения. Демо-песочница не запускает оплату.',
  accountSignedIn: 'Вы вошли. Продолжите настройку в кабинете.',
  accountContinue: 'Продолжить настройку',
  accountLogin: 'Войти',
  accountCreate: 'Создать кабинет',
  demoTitle: 'Интерактивная демонстрация',
  commercialLabel: 'Условия подключения',
  console: 'Личный кабинет',
  platform: 'Платформа',
  verticalLabel: 'Вертикаль',
  languageLabel: 'Язык',
  navLabel: 'Кабинет',
  demoKicker: 'Демо 7 дней · 0 платных токенов LLM',
  demoBody: 'Один проход для гостеприимства: выезд гостя, проверка номера, назначение горничной, затем себестоимость и запись аудита. Песочница не вызывает платную модель.',
  demoButton: 'Запустить демо-сценарий',
  demoRunning: 'Выполняется…',
  demoFoot: 'Только песочница · списано токенов: 0',
  demoError: 'Песочница не запустилась. Повторите.',
  stepsTitle: 'Шаги',
  auditEmpty: 'Записей демо пока нет. Запустите сценарий на главном экране.',
  immutable: 'Неизменяемая',
  verticals: {
    hospitality: 'Гостеприимство',
    real_estate: 'Недвижимость',
    industrial: 'Промышленность',
    marketplaces: 'Маркетплейсы',
  },
  nav: {
    properties: 'Объекты',
    operations: 'Операции',
    audit: 'Журнал проверок',
    plan: 'Тариф и лимиты',
  },
  sectionLead: {
    properties: 'Объекты выбранной вертикали. Цифры — демонстрационные.',
    operations: 'Открытая работа и назначенные люди.',
    audit: 'Записи песочницы в этой сессии не редактируются.',
  },
  stepState: { pending: 'Ожидание', active: 'В работе', done: 'Готово' },
  plan: [
    { label: 'Тариф', value: 'Демо 7 дней' },
    { label: 'Цена демо', value: '0' },
    { label: 'Платные LLM', value: '0' },
    { label: 'Окно демо', value: '7 дней' },
  ],
  planNote: 'Это демонстрационная песочница с примерными объектами и пятью слотами персонала, не пилот на реальном объекте и не платная подписка. Платные модели не вызываются.',
};

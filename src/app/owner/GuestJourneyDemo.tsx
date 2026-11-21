'use client';

import { useEffect, useState } from 'react';
import { chooseRefundPath, storyScenes, type StoryRole } from '@/lib/owner-console/journey-story';
import { storyEvidence } from '@/lib/owner-console/journey-evidence';
import type { OwnerLang } from '@/lib/owner-console/context';

const ROLE_NAMES: Record<OwnerLang, Record<StoryRole, string>> = {
  ru: { guest: 'Гость', manager: 'Управляющий', owner: 'Владелец' },
  en: { guest: 'Guest', manager: 'Manager', owner: 'Owner' },
};

const LABELS = {
  ru: {
    eyebrow: 'История одной брони · интерактивный сценарий',
    title: 'Один гость. Девять ситуаций. Один ASI.',
    lead: 'Посмотрите, как единая система могла бы сопровождать гостя, принимать решения в пределах полномочий и передавать исключения человеку.',
    simulated: 'СИМУЛЯЦИЯ · вымышленные данные',
    important: 'Это продуктовый сценарий, а не запись работы реального объекта. Сообщения, звонки, датчики, платежи и вызовы служб не выполняются.',
    moment: 'Что произошло',
    action: 'Что делает ASI',
    policy: 'Граница автономии и безопасность',
    role: 'Смотрите глазами',
    screen: 'Как это выглядит в интерфейсе',
    artifact: 'Экран',
    step: 'Сцена',
    previous: 'Назад',
    next: 'Следующая сцена',
    restart: 'Начать сначала',
    autoplay: 'Смотреть историю автоматически',
    pause: 'Пауза',
    small: 'Возврат за 3 ночи — в лимите',
    large: 'За 4 ночи — согласование',
    delegated: 'Делегированный лимит: расчёт может пройти без обращения к владельцу после проверки фонда и правил бронирования.',
    approval: 'Превышение лимита: никакой выплаты и изменения брони до явного решения владельца.',
    ownerEscalation: 'Владельцу направлен запрос на согласование; автоматический возврат заблокирован.',
    safe: 'Действия показаны в песочнице · 0 реальных отправок · 0 платежей',
    evidence: 'Реальный пилот требует подтверждённых интеграций: OTA/PMS, каналы связи, датчики, выплаты и согласия.',
    more: 'Для инженера: прежняя техническая демонстрация доступна ниже.',
    count: 'Из 9 сцен',
  },
  en: {
    eyebrow: 'One booking · interactive story',
    title: 'One guest. Nine situations. One ASI.',
    lead: 'See how a single platform could support a guest, make delegated decisions and escalate unusual cases to a person.',
    simulated: 'SIMULATION · fictional data',
    important: 'This is a product walkthrough, not a recording from a live property. No messages, calls, sensors, payments or emergency dispatch are triggered.',
    moment: 'What happened',
    action: 'ASI decision',
    policy: 'Autonomy boundaries',
    role: 'View as',
    screen: 'What they would see',
    artifact: 'Screen',
    step: 'Scene',
    previous: 'Previous',
    next: 'Next scene',
    restart: 'Restart',
    autoplay: 'Play the story automatically',
    pause: 'Pause',
    small: '3-night refund — within policy',
    large: '4-night refund — owner approval',
    delegated: 'Within delegated limits: the estimate can proceed after funding, consent and rate-rule checks.',
    approval: 'Outside delegated limits: no refund or booking change before explicit owner approval.',
    ownerEscalation: 'The owner receives an approval request; automatic refund is blocked.',
    safe: 'Sandbox-only actions · 0 real messages · 0 payments',
    evidence: 'A live pilot needs verified OTA/PMS, communications, sensors, payment and consent integrations.',
    more: 'For engineers: the original technical demo remains available below.',
    count: 'of 9 scenes',
  },
} as const;

export default function GuestJourneyDemo({ lang }: { lang: OwnerLang }) {
  const scenes = storyScenes(lang);
  const copy = LABELS[lang];
  const [index, setIndex] = useState(0);
  const [role, setRole] = useState<StoryRole>('guest');
  const [playing, setPlaying] = useState(false);
  const [refundNights, setRefundNights] = useState(3);
  const current = scenes[index];
  const board = storyEvidence(lang, current.id, refundNights);
  const refundPath = chooseRefundPath(refundNights);

  useEffect(() => {
    if (!playing) return;
    if (index >= scenes.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex((value) => Math.min(value + 1, scenes.length - 1)), 5500);
    return () => window.clearTimeout(timer);
  }, [playing, index, scenes.length]);

  const stageDecision = current.id === 'refund'
    ? (refundPath === 'approval' ? copy.approval : copy.delegated)
    : current.decision;
  const roleMessages = current.id === 'refund' && refundPath === 'approval' && role === 'owner'
    ? [copy.ownerEscalation, ...current.view.owner]
    : current.view[role];

  return (
    <section data-testid="guest-journey-demo" aria-label={copy.title} className="mb-10 overflow-hidden border border-asi-border bg-asi-paper">
      <div className="bg-asi-navy px-6 py-8 text-asi-ivory sm:px-10 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft">{copy.eyebrow}</p>
          <span className="border border-asi-gold-soft/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-asi-gold-soft">
            {copy.simulated}
          </span>
        </div>
        <h1 className="mt-5 max-w-4xl font-serif text-4xl leading-tight sm:text-5xl">{copy.title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-asi-ivory/80">{copy.lead}</p>
        <p className="mt-4 max-w-4xl text-sm leading-relaxed text-asi-ivory/60">{copy.important}</p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => { if (index >= scenes.length - 1) setIndex(0); setPlaying((value) => !value); }}
            aria-pressed={playing}
            className="min-h-[44px] bg-asi-ivory px-5 py-3 text-sm font-semibold text-asi-navy hover:bg-asi-gold-soft"
          >{playing ? copy.pause : copy.autoplay}</button>
          <button type="button" onClick={() => { setPlaying(false); setIndex(0); setRefundNights(3); }}
            className="min-h-[44px] border border-asi-ivory/40 px-5 py-3 text-sm font-semibold text-asi-ivory hover:bg-asi-ivory/10">
            {copy.restart}
          </button>
          <span className="text-sm text-asi-ivory/70">{index + 1} {copy.count}</span>
        </div>
        <div className="mt-5 h-1 w-full bg-asi-ivory/20" aria-hidden="true">
          <div className="h-full bg-asi-gold-soft transition-all duration-300"
            style={{ width: String(((index + 1) / scenes.length) * 100) + '%' }} />
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.88fr,1.62fr]">
        <nav className="border-b border-asi-border bg-asi-ivory p-4 lg:border-b-0 lg:border-r lg:p-5" aria-label={copy.step}>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {scenes.map((scene, i) => (
              <li key={scene.id}>
                <button
                  type="button"
                  onClick={() => { setPlaying(false); setIndex(i); }}
                  aria-current={index === i ? 'step' : undefined}
                  className={
                    'flex min-h-[54px] w-full items-start gap-3 border px-3 py-3 text-left text-sm transition-colors ' +
                    (index === i ? 'border-asi-navy bg-asi-navy text-asi-ivory' : 'border-asi-border bg-asi-paper text-asi-navy hover:border-asi-gold-text')
                  }
                >
                  <span className="text-xs font-semibold opacity-60">{String(i + 1).padStart(2, '0')}</span>
                  <span className="font-semibold leading-snug">{scene.heading}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="p-5 sm:p-8" aria-live="polite" aria-atomic="false">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-asi-gold-text">{current.time}</span>
            <span className="text-xs text-asi-navy/60">{copy.artifact}: {current.artifact}</span>
          </div>
          <h2 className="mt-3 font-serif text-3xl leading-tight sm:text-4xl">{current.heading}</h2>
          <div className="mt-6 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-asi-gold-text">{copy.moment}</p>
              <p className="mt-2 text-base leading-relaxed">{current.situation}</p>
            </div>
            {current.id === 'refund' ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={copy.action}>
                <button type="button" aria-pressed={refundNights === 3} onClick={() => setRefundNights(3)}
                  className={'min-h-[42px] border px-3 py-2 text-sm font-semibold ' +
                    (refundNights === 3 ? 'border-asi-navy bg-asi-navy text-asi-ivory' : 'border-asi-border text-asi-navy hover:border-asi-navy')}>
                  {copy.small}
                </button>
                <button type="button" aria-pressed={refundNights === 4} onClick={() => setRefundNights(4)}
                  className={'min-h-[42px] border px-3 py-2 text-sm font-semibold ' +
                    (refundNights === 4 ? 'border-asi-navy bg-asi-navy text-asi-ivory' : 'border-asi-border text-asi-navy hover:border-asi-navy')}>
                  {copy.large}
                </button>
              </div>
            ) : null}
            <div className="border-l-4 border-asi-gold-text bg-asi-ivory p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-asi-gold-text">{copy.action}</p>
              <p className="mt-2 text-base leading-relaxed">{stageDecision}</p>
            </div>
          </div>
          <div className="mt-7 border border-asi-border bg-asi-ivory p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-asi-gold-text">{copy.role}</p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={copy.role}>
              {(['guest', 'manager', 'owner'] as const).map((item) => (
                <button key={item} type="button" aria-pressed={role === item} onClick={() => setRole(item)}
                  className={'min-h-[44px] border px-4 py-2 text-sm font-semibold ' +
                    (role === item ? 'border-asi-navy bg-asi-navy text-asi-ivory' : 'border-asi-border bg-asi-paper text-asi-navy hover:border-asi-navy')}>
                  {ROLE_NAMES[lang][item]}
                </button>
              ))}
            </div>
            <div className="mt-5 border border-asi-border bg-asi-paper p-4">
              <div className="flex items-center justify-between gap-2 border-b border-asi-border pb-3">
                <p className="font-serif text-xl">{copy.screen}: {ROLE_NAMES[lang][role]}</p>
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-asi-gold-text">{copy.simulated}</span>
              </div>
              <ul className="mt-4 space-y-3">
                {roleMessages.map((message, idx) => (
                  <li key={String(idx) + '-' + current.id}
                    className={'max-w-[95%] border border-asi-border p-3 text-sm leading-relaxed ' +
                      (role === 'guest' && idx % 2 === 1 ? 'ml-auto bg-asi-ivory' : 'bg-asi-paper')}>
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-6 border border-asi-border bg-asi-ivory p-4 sm:p-5" data-testid="journey-evidence-board">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-serif text-2xl">{board.title}</h3>
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-asi-gold-text">{copy.simulated}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-2">
              {board.items.map((item) => (
                <div key={item.label} className="border border-asi-border bg-asi-paper p-3">
                  <dt className="text-xs text-asi-navy/60">{item.label}</dt>
                  <dd className="mt-2 text-sm font-semibold leading-relaxed text-asi-navy">{item.value}</dd>
                </div>
              ))}
            </dl>
            {current.id === 'reservation' || current.id === 'resale' ? (
              <div className="mt-4" aria-label={lang === 'ru' ? 'Учебный календарь доступности' : 'Sample availability calendar'}>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: 7 }, (_, day) => (
                    <span key={day} className="flex aspect-square items-center justify-center border border-asi-gold-text/50 bg-asi-gold-soft/30 text-xs font-semibold text-asi-navy">
                      {day + 1}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-asi-navy/60">{current.id === 'reservation'
                  ? (lang === 'ru' ? 'Учебная бронь блокирует эти даты' : 'Sample booking blocks these nights')
                  : (lang === 'ru' ? 'Даты открыты и повторно проданы только в учебном сценарии' : 'Nights released and resold in the sample story only')}</p>
              </div>
            ) : null}
            <p className="mt-4 text-xs leading-relaxed text-asi-navy/60">{board.footnote}</p>
          </div>
          <div className="mt-6 border-t border-asi-border pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-asi-gold-text">{copy.policy}</p>
            <p className="mt-2 text-sm leading-relaxed text-asi-navy/75">{current.policy}</p>
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <button type="button" disabled={index === 0} onClick={() => { setPlaying(false); setIndex((value) => Math.max(0, value - 1)); }}
              className="min-h-[44px] border border-asi-navy px-5 py-3 text-sm font-semibold disabled:opacity-30">{copy.previous}</button>
            <button type="button" onClick={() => { setPlaying(false); setIndex((value) => Math.min(scenes.length - 1, value + 1)); }}
              disabled={index === scenes.length - 1}
              className="min-h-[44px] bg-asi-navy px-5 py-3 text-sm font-semibold text-asi-ivory disabled:opacity-40">{copy.next}</button>
          </div>
        </div>
      </div>
      <footer className="border-t border-asi-border bg-asi-ivory px-6 py-5 sm:px-10">
        <p className="text-sm font-semibold">{copy.safe}</p>
        <p className="mt-2 text-sm leading-relaxed text-asi-navy/70">{copy.evidence}</p>
        <p className="mt-2 text-xs text-asi-navy/60">{copy.more}</p>
      </footer>
    </section>
  );
}

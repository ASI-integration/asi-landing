'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation, type Locale } from '@/i18n/useTranslation';

const COPY: Record<Locale, any> = {
  en: {
    pageTitle: "Early Access & Strategic Participation",
    heroHeading: "AI Platform for Short-Term Rental Automation",
    heroSubheading: "We are building an engine that reduces reliance on manual management, fragmented services, and constant operational overhead in short-term rentals.",
    heroBody: "This is not just another software product; we are creating an operational layer that unifies guest communication, bookings, calendars, process coordination, and channel manager logic into a single automated system.",
    sec1Title: "What is already built",
    sec1Body1: "At this stage, the working core of the project is formed:",
    sec1List: [
      "base frontend and site",
      "product architecture",
      "automation logic for key processes",
      "visible contour of future modules",
      "pilot intake flow"
    ],
    sec2Title: "What is being finalized now",
    sec2Body1: "We are currently strengthening several key directions in parallel:",
    sec2List: [
      "communication module",
      "payment contour",
      "expansion of intake / onboarding flow",
      "early access scenarios and demos"
    ],
    sec3Title: "Why this makes practical sense",
    sec3Body: "Even with a small number of properties, a significant portion of resources goes into manual management, bookings, coordination, control, and external services. Our goal is to transfer a substantial part of these processes into a single automated contour to reduce operational load, decrease reliance on staff, and cut costs on the external stack.",
    sec3Callout: "Even for 5 properties, basic booking and management functions can cost approximately 100,000–150,000 rubles per month for just two roles, excluding cleaning, maintenance, and other expenses. Automation here means not only convenience but potential savings, scalability, and margin growth.",
    sec4Title: "Who might be interested",
    sec4Body1: "This format might be interesting to:",
    sec4List: [
      "those who already manage properties and want to reduce manual load",
      "those who see the potential of early entry into an applied AI product",
      "those who can participate not only with funding but with expertise, network, or a pilot site",
      "those who align with a transparent model of early-stage co-development"
    ],
    sec5Title: "How we see early participation",
    sec5Body: "We are not just looking for funding, but strategic participation. The format can be discussed transparently with the right partner: from pilot interaction and technological participation to a deeper project entry model. At this stage, finding a strong match in interest, vision, and practical utility is more important to us than formally reducing the conversation to money.",
    sec6Title: "What's Next",
    sec6Body: "If this direction broadly resonates with you, the next step could be a short conversation, a review of the current project stage, and a discussion of a possible participation format.",
    cta1: "Request project review",
    cta2: "Discuss early participation",
    formTitle: "Request Strategic Dialogue",
    formName: "Name",
    formCompany: "Company / Project",
    formRole: "Your Role",
    formAffinityLabel: "What is closest to you?",
    formAffinityOptions: [
      "early access",
      "strategic participation",
      "pilot",
      "investment interest",
      "technology partnership",
    ],
    formInterestLabel: "What exactly are you interested in?",
    formInterestPlaceholder: "Briefly describe what interests you: a pilot, participation in development, investment format, technology partnership, or project review.",
    formContactLabel: "Contact info (Email / Telegram)",
    formSubmit: "Send Request",
    formNote: "This form is a placeholder and not yet connected to an API backend.",
  },
  ru: {
    pageTitle: "Ранний доступ и стратегическое участие",
    heroHeading: "AI-платформа для автоматизации управления краткосрочной арендой",
    heroSubheading: "Мы развиваем систему, которая помогает снизить зависимость от ручного управления, разрозненных сервисов и постоянной операционной нагрузки в short-term rental.",
    heroBody: "Речь идёт не просто о программном продукте, а о создании операционного слоя, который объединяет коммуникацию с гостями, бронирования, календари, координацию процессов и логику channel manager в единую систему автоматизации.",
    sec1Title: "Что уже сделано",
    sec1Body1: "На текущем этапе сформировано рабочее ядро проекта:",
    sec1List: [
      "базовый фронтенд и сайт",
      "архитектура продукта",
      "логика автоматизации ключевых процессов",
      "видимый контур будущих модулей",
      "пилотный сценарий подключения и intake flow"
    ],
    sec2Title: "Что сейчас дорабатывается",
    sec2Body1: "Сейчас мы параллельно усиливаем несколько ключевых направлений:",
    sec2List: [
      "коммуникационный модуль",
      "платежный контур",
      "расширение intake / onboarding flow",
      "сценарии раннего подключения и демонстрации"
    ],
    sec3Title: "Почему это имеет практический смысл",
    sec3Body: "Даже на небольшом количестве объектов значительная часть ресурсов уходит на ручное управление, бронирования, координацию, контроль и внешние сервисы. Наша цель — перевести часть этих процессов в единый автоматизированный контур, чтобы снизить операционную нагрузку, уменьшить зависимость от персонала и сократить расходы на внешний стек.",
    sec3Callout: "Даже на 5 объектах базовые функции бронирования и управления могут обходиться примерно в 100 000–150 000 рублей в месяц только по двум ролям (без учета уборки и обслуживания). Автоматизация здесь — это потенциальная экономия, масштабируемость и рост маржинальности.",
    sec4Title: "Кому это может быть интересно",
    sec4Body1: "Этот формат может быть интересен:",
    sec4List: [
      "тем, кто уже управляет объектами и хочет снизить ручную нагрузку",
      "тем, кто видит потенциал раннего входа в прикладной AI-продукт",
      "тем, кто может участвовать не только финансированием, но и экспертизой, связями или пилотной площадкой",
      "тем, кому близка прозрачная модель совместного развития"
    ],
    sec5Title: "Как мы видим раннее участие",
    sec5Body: "Мы ищем не просто финансирование, а стратегическое участие. Формат может обсуждаться прозрачно с подходящим партнёром: от пилотного взаимодействия и технологического участия до более глубокой модели входа в проект. На данном этапе для нас важнее найти сильное совпадение по интересу, видению и практической пользе, чем формально сводить разговор к деньгам.",
    sec6Title: "Что дальше",
    sec6Body: "Если направление вам откликается, следующим шагом может быть короткий разговор, обзор текущей стадии проекта и обсуждение возможного формата.",
    cta1: "Запросить обзор проекта",
    cta2: "Обсудить раннее участие",
    formTitle: "Запрос на стратегический диалог",
    formName: "Имя",
    formCompany: "Компания / проект",
    formRole: "Ваша роль",
    formAffinityLabel: "Что вам ближе",
    formAffinityOptions: [
      "ранний доступ",
      "стратегическое участие",
      "пилот",
      "инвестиционный интерес",
      "технологическое партнёрство",
    ],
    formInterestLabel: "Что именно интересно",
    formInterestPlaceholder: "Коротко опишите, что вам интересно: пилот, участие в развитии, инвестиционный формат, технологическое партнёрство или обзор проекта.",
    formContactLabel: "Контакт для связи (Email / Telegram)",
    formSubmit: "Отправить запрос",
    formNote: "Форма пока работает в режиме плейсхолдера (заявки временно не отправляются).",
  },
};

export function StrategicLanding() {
  const { locale } = useTranslation();
  const t = COPY[locale] || COPY['ru'];

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert(t.formNote);
  };

  return (
    <div className="pb-24">
      {/* 1. Hero Section matches the dark production Home Hero */}
      <section className="relative py-24 sm:py-32 flex flex-col items-center justify-center overflow-hidden bg-slate-900 text-center px-4 sm:px-6 lg:px-8">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(148, 163, 184, 0.15), transparent)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
        <div className="relative z-10 max-w-4xl mx-auto">
          <span className="inline-flex items-center rounded-full bg-slate-800/50 border border-slate-700 px-4 py-1.5 text-sm font-medium text-slate-300 mb-6">
            {t.pageTitle}
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-tight">
            {t.heroHeading}
          </h1>
          <p className="mt-6 text-xl sm:text-2xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
            {t.heroSubheading}
          </p>
          <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            {t.heroBody}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="#strategic-form"
              className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 text-lg font-semibold rounded-xl hover:bg-slate-100 transition-all duration-300 shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02]"
            >
              {t.cta2}
            </a>
            <a
              href="#strategic-form"
              className="inline-flex items-center justify-center px-8 py-4 border-2 border-slate-400 text-white text-lg font-semibold rounded-xl hover:bg-white/10 hover:border-slate-300 transition-all duration-300"
            >
              {t.cta1}
            </a>
          </div>
        </div>
      </section>

      {/* 2. Content Sections - matched to bg-slate-50 / bg-white rhythm */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 mt-16 sm:mt-24 space-y-16">
        
        {/* Two Columns: Built vs Finalizing */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md">
            <h2 className="text-xl font-bold text-slate-900">{t.sec1Title}</h2>
            <p className="mt-4 text-base text-slate-600">{t.sec1Body1}</p>
            <ul className="mt-5 space-y-3 text-base text-slate-600 list-none">
              {t.sec1List.map((item: string, i: number) => (
                <li key={i} className="flex gap-3">
                  <span className="text-slate-400 flex-shrink-0">&rarr;</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md">
            <h2 className="text-xl font-bold text-slate-900">{t.sec2Title}</h2>
            <p className="mt-4 text-base text-slate-600">{t.sec2Body1}</p>
            <ul className="mt-5 space-y-3 text-base text-slate-600 list-none">
              {t.sec2List.map((item: string, i: number) => (
                <li key={i} className="flex gap-3">
                  <span className="text-slate-400 flex-shrink-0">&rarr;</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Why it makes sense */}
        <section className="rounded-2xl border border-slate-200 bg-white p-8 sm:p-10 shadow-sm transition-shadow hover:shadow-md">
          <h2 className="text-2xl font-bold text-slate-900">{t.sec3Title}</h2>
          <p className="mt-4 text-lg text-slate-600 leading-relaxed">
            {t.sec3Body}
          </p>
          <div className="mt-8 rounded-xl bg-slate-50 p-6 sm:p-8 border border-slate-100 text-base text-slate-700 leading-relaxed relative">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-slate-300 rounded-l-xl"></div>
            <p className="italic">{t.sec3Callout}</p>
          </div>
        </section>

        {/* Who might be interested & How we see early participation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md">
            <h2 className="text-xl font-bold text-slate-900">{t.sec4Title}</h2>
            <p className="mt-4 text-base text-slate-600 leading-relaxed">{t.sec4Body1}</p>
            <ul className="mt-5 space-y-3 text-base text-slate-600">
              {t.sec4List.map((item: string, i: number) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="text-slate-400 mt-0.5 flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md">
            <h2 className="text-xl font-bold text-slate-900">{t.sec5Title}</h2>
            <p className="mt-4 text-base text-slate-600 leading-relaxed">
              {t.sec5Body}
            </p>
          </section>
        </div>

        {/* What's Next & Form */}
        <div className="mx-auto max-w-3xl text-center mt-20 mb-10">
          <h2 className="text-2xl font-bold text-slate-900">{t.sec6Title}</h2>
          <p className="mt-4 text-lg text-slate-600 leading-relaxed">
            {t.sec6Body}
          </p>
        </div>

        <section id="strategic-form" className="mx-auto max-w-3xl scroll-mt-32 rounded-3xl border border-slate-200 bg-white p-8 sm:p-12 shadow-xl shadow-slate-200/50 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-slate-800 to-slate-900"></div>
          <h2 className="text-2xl font-bold text-slate-900 mb-8">{t.formTitle}</h2>
          
          <form className="space-y-6" onSubmit={handleFormSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t.formName}</label>
                <input required type="text" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 transition-shadow" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t.formCompany}</label>
                <input required type="text" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 transition-shadow" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t.formRole}</label>
                <input required type="text" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 transition-shadow" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t.formContactLabel}</label>
                <input required type="text" placeholder="name@company.com" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 transition-shadow" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">{t.formAffinityLabel}</label>
              <select required className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 bg-white focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 transition-shadow">
                <option value="" disabled selected>—</option>
                {t.formAffinityOptions.map((opt: string, i: number) => (
                  <option key={i} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">{t.formInterestLabel}</label>
              <textarea 
                required 
                rows={4} 
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none transition-shadow"
                placeholder={t.formInterestPlaceholder}
              ></textarea>
            </div>

            <div className="pt-4">
              <button type="submit" className="w-full inline-flex items-center justify-center px-8 py-4 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-all duration-300 shadow-lg shadow-slate-900/20 hover:shadow-xl hover:shadow-slate-900/30">
                {t.formSubmit}
              </button>
              <p className="text-sm font-medium text-amber-700 bg-amber-50 rounded-lg p-3 mt-6 text-center border border-amber-100">
                {t.formNote}
              </p>
            </div>
          </form>
        </section>

      </div>
    </div>
  );
}

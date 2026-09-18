import type { Metadata } from 'next';
import {
  BrandEyebrow,
  BrandGoldRule,
  BrandHeadline,
  BrandLogoMark,
  BrandPrimaryCta,
  BrandSecondaryCta,
  BrandSection,
  BrandShiro,
} from '@/components/brand';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { COMMUNICATION_PILOT_PRICE_RUB } from '@/lib/payments/yookassa-env';

export const metadata: Metadata = {
  title: 'ASI — общение с гостями по данным объекта',
  description:
    'ASI берёт на себя повторяющиеся вопросы гостей по данным объекта, а человеку оставляет ситуации, где нужно решение. Бесплатное подключение, 14 дней пилота после готовности, затем 1 000 ₽ за объект в месяц.',
};

const PILOT_HREF = '/ru/early-access';
const HOW_HREF = '/ru/how-it-works';
/** Secondary product: location scoring demo. */
const RU_LOCATION_CHECK_HREF = '/ru/location-analysis?mode=residential#location-check';

const PRIMARY_CTA_LABEL = 'Подключить объект бесплатно';
const SECONDARY_CTA_LABEL = 'Как работает пилот';

const CHANNEL_LAYER_POINTS = [
  {
    title: 'Поток бронирований',
    body: 'Менеджер каналов управляет потоком бронирований и синхронизацией календарей.',
  },
  {
    title: 'Общение с гостями',
    body: 'ASI берёт на себя повторяющиеся вопросы гостей по данным конкретного объекта.',
  },
  {
    title: 'Человек — для решений',
    body: 'Ваша команда подключается, когда ситуация нестандартная или данных недостаточно.',
  },
] as const;

const ROUTINE_ITEMS = [
  'Частые вопросы гостей: заезд, Wi-Fi, парковка, правила объекта',
  'Повторяющиеся уточнения по данным объекта',
  'Типовые операционные напоминания, если они заданы в инструкции объекта',
] as const;

const EXCEPTION_ITEMS = [
  'Нестандартные или конфликтные ситуации',
  'Случаи, когда в базе знаний не хватает подтверждённых данных',
  'Решения, которые должны принять вы или ваша команда',
] as const;

const JOURNEY_STEPS = [
  {
    n: '01',
    title: 'Заявка и бесплатная настройка',
    body: 'Вы передаёте данные объекта. Мы готовим систему. Этот этап не входит в 14 дней пилота.',
  },
  {
    n: '02',
    title: '14 дней на реальном объекте',
    body: 'Отсчёт начинается только после полной готовности. ASI работает с реальными обращениями гостей.',
  },
  {
    n: '03',
    title: 'Итоговый разбор',
    body: 'Показываем, какие типовые сценарии проходили через систему, где нужен был человек и что уточнить в инструкциях.',
  },
  {
    n: '04',
    title: 'Решение о продолжении',
    body: 'Автоматического перехода на оплату нет. Если продолжаете — 1 000 ₽ за объект в месяц.',
  },
] as const;

const REPORT_ITEMS = [
  {
    title: 'Типовые сценарии',
    body: 'Какие повторяющиеся вопросы гостей обрабатывались по данным объекта.',
  },
  {
    title: 'Где нужен человек',
    body: 'В каких ситуациях автоматический ответ останавливался и требовалась проверка.',
  },
  {
    title: 'Пробелы в данных',
    body: 'Где информации объекта не хватало для уверенного ответа.',
  },
  {
    title: 'Что уточнить дальше',
    body: 'Какие инструкции стоит добавить или прояснить, чтобы снизить ручную работу.',
  },
] as const;

const AUDIENCE_ITEMS = [
  {
    title: 'Собственники объектов',
    body: 'Нужно снять с себя постоянную переписку с гостями, не теряя контроль над исключениями.',
  },
  {
    title: 'Небольшие команды эксплуатации',
    body: 'Хотите снизить объём ручной координации и оставить людям только нестандартные случаи.',
  },
  {
            title: 'Операторы с менеджером каналов',
            body: 'Уже ведёте поток бронирований через менеджер каналов и хотите снизить ручную переписку с гостями поверх него.',
          },
] as const;

const FAQ = [
  {
    q: 'Когда начинается отсчёт 14 дней?',
    a: 'Только после полной технической готовности объекта. Бесплатное подключение и настройка в эти дни не входят.',
  },
  {
    q: 'Что входит в бесплатное подключение?',
    a: 'Сбор и структурирование правил объекта, подготовка базы знаний и технические проверки готовности.',
  },
  {
    q: 'Будет ли автоматический переход на оплату?',
    a: 'Нет. Сначала вы видите итоговый отчёт по пилоту. Решение о продолжении принимаете вы. При продолжении — 1 000 ₽ за объект в месяц.',
  },
  {
    q: 'Когда подключается человек?',
    a: 'Когда ситуация нестандартная или данных объекта недостаточно. ASI снижает объём ручной координации, но не снимает человеческий контроль полностью.',
  },
  {
    q: 'Как ASI отвечает гостям?',
    a: 'ASI работает на основе подтверждённых данных объекта. Если информации недостаточно, вопрос передаётся человеку или запрашиваются недостающие данные.',
  },
  {
    q: 'Нужно ли менять менеджер каналов?',
    a: 'Нет. Менеджер каналов управляет потоком бронирований. ASI помогает с повторяющимся общением с гостями вокруг них. Подключение необходимых систем выполняется на этапе настройки после проверки совместимости.',
  },
] as const;

function HeroVisual() {
  return (
    <div className="relative border border-asi-border bg-asi-paper p-6 sm:p-8 min-h-[22rem] sm:min-h-[28rem] flex flex-col justify-between">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandLogoMark size={28} />
          <span className="font-serif text-xl text-asi-navy">ASI</span>
        </div>
        <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
          Пилот
        </span>
      </div>

      <div className="mt-8 grid gap-px bg-asi-border border border-asi-border">
        <div className="bg-asi-ivory p-5 sm:p-6">
          <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
            Повторяемое → ASI
          </p>
          <p className="mt-3 font-serif text-xl text-asi-navy leading-snug">
            Типовые вопросы гостей по данным объекта.
          </p>
        </div>
        <div className="bg-asi-ivory p-5 sm:p-6">
          <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
            Решение → человек
          </p>
          <p className="mt-3 font-serif text-xl text-asi-navy leading-snug">
            Ситуации, где нужно суждение, остаются за вами.
          </p>
        </div>
      </div>

      <div className="mt-8 flex items-end justify-between gap-4">
        <p className="text-sm text-asi-navy/65 leading-relaxed max-w-[16rem]">
          Подключение — 0&nbsp;₽ · 14 дней после готовности · затем{' '}
          {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ / объект / месяц
        </p>
        <BrandShiro size={56} />
      </div>
    </div>
  );
}

export default function HomeRu() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader density="landing" />

      <main>
        {/* ── 1. Hero ── */}
        <section className="relative bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 overflow-hidden">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.05fr,0.95fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="flex items-center gap-3">
                <BrandLogoMark size={34} />
                <span className="font-serif text-2xl text-asi-navy">ASI</span>
              </div>
              <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                ASI · для посуточной аренды
              </p>
              <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.5rem]">
                Управлять посуточными квартирами — не значит весь день сидеть в чатах
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-lg leading-relaxed">
                ASI берёт на себя повторяющиеся вопросы гостей по данным объекта, а человеку
                оставляет ситуации, где нужно решение.
              </p>
              <p className="mt-4 text-sm font-sans text-asi-navy/60 tracking-wide leading-relaxed max-w-xl">
                Настройка и подключение — 0&nbsp;₽ · 14 дней отсчитываются только после полной
                готовности объекта · {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ / объект / месяц при
                решении продолжить
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <BrandPrimaryCta href={PILOT_HREF}>{PRIMARY_CTA_LABEL}</BrandPrimaryCta>
                <BrandSecondaryCta href={HOW_HREF}>{SECONDARY_CTA_LABEL}</BrandSecondaryCta>
              </div>
            </div>
            <HeroVisual />
          </div>
        </section>

        {/* ── 2. Channel manager layer ── */}
        <BrandSection variant="paper">
          <BrandEyebrow>Рядом с бронированиями</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Работает вместе с вашим менеджером каналов
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Менеджер каналов ведёт поток бронирований. ASI помогает с повторяющимся общением с
            гостями вокруг них.
          </p>
          <div className="mt-12 grid md:grid-cols-3 gap-px bg-asi-border border border-asi-border">
            {CHANNEL_LAYER_POINTS.map((item) => (
              <div key={item.title} className="bg-asi-ivory p-7 sm:p-8">
                <h3 className="font-serif text-xl text-asi-navy">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </BrandSection>

        {/* ── 3. Routine vs exceptions ── */}
        <BrandSection variant="navy">
          <BrandEyebrow dark>Модель работы</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            Обычные ситуации vs Исключения
          </BrandHeadline>
          <div className="mt-12 grid md:grid-cols-2 gap-px bg-asi-ivory/15 border border-asi-ivory/15">
            <div className="bg-asi-navy p-8 sm:p-10">
              <span className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-soft">
                Рутина → ASI
              </span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl text-asi-ivory">Обычные ситуации</h3>
              <ul className="mt-5 space-y-3 text-asi-ivory/70 leading-relaxed">
                {ROUTINE_ITEMS.map((item) => (
                  <li key={item} className="border-t border-asi-ivory/15 pt-3">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-asi-navy p-8 sm:p-10">
              <span className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-soft">
                Исключение → человек
              </span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl text-asi-ivory">Исключения</h3>
              <ul className="mt-5 space-y-3 text-asi-ivory/70 leading-relaxed">
                {EXCEPTION_ITEMS.map((item) => (
                  <li key={item} className="border-t border-asi-ivory/15 pt-3">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-8 text-asi-ivory/60 max-w-xl leading-relaxed">
            ASI снижает объём ручной координации и контроля. Решение по исключениям остаётся за
            человеком.
          </p>
        </BrandSection>

        {/* ── 4. Knowledge accuracy ── */}
        <BrandSection variant="ivory">
          <BrandEyebrow>База знаний</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Точность коммуникации и базы знаний
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-6" />
          <p className="max-w-2xl text-asi-navy/70 leading-relaxed">
            ASI работает на основе подтверждённых данных объекта. Если информации недостаточно,
            вопрос передаётся человеку или запрашиваются недостающие данные.
          </p>
          <div className="mt-10 grid sm:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            <div className="bg-asi-paper p-7 sm:p-8">
              <h3 className="font-serif text-xl text-asi-navy">Ответы по вашему объекту</h3>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
                Коммуникация опирается на инструкции, правила и сведения, которые вы передаёте при
                подключении и уточняете в ходе настройки.
              </p>
            </div>
            <div className="bg-asi-paper p-7 sm:p-8">
              <h3 className="font-serif text-xl text-asi-navy">Без абсолютных гарантий «идеала»</h3>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
                Мы не обещаем нулевых ошибок любой ценой. Недостаток данных — повод эскалировать
                человеку, а не отвечать наугад.
              </p>
            </div>
          </div>
        </BrandSection>

        {/* ── 5. Journey chronology ── */}
        <BrandSection variant="paper" id="pilot-path">
          <BrandEyebrow>Путь пилота</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            От заявки до результата
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Подключение и настройка идут до старта пилота и не расходуют 14 дней.
          </p>
          <ol className="mt-12 grid md:grid-cols-2 xl:grid-cols-4 gap-0 border border-asi-border divide-y md:divide-y-0 md:divide-x divide-asi-border">
            {JOURNEY_STEPS.map((step) => (
              <li key={step.n} className="bg-asi-ivory p-7 sm:p-8 flex flex-col">
                <span className="font-serif text-asi-gold text-2xl">{step.n}</span>
                <h3 className="mt-4 font-serif text-xl text-asi-navy">{step.title}</h3>
                <p className="mt-3 flex-1 text-sm text-asi-navy/65 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </BrandSection>

        {/* ── 6. 14-day report ── */}
        <BrandSection variant="ivory" id="pilot-report">
          <BrandEyebrow>Итог пилота</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Итоговый разбор после пилота
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            После пилота вы получаете понятный разбор работы на вашем объекте — до решения о
            продолжении. Это итог пилота, а не отдельный продукт аналитики.
          </p>
          <div className="mt-12 grid sm:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            {REPORT_ITEMS.map((item) => (
              <div key={item.title} className="bg-asi-paper p-7 sm:p-8">
                <h3 className="font-serif text-xl text-asi-navy">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-sm text-asi-navy/60 leading-relaxed">
            Разбор строится по наблюдениям пилота на вашем объекте и помогает решить, продолжать ли.
          </p>
        </BrandSection>

        {/* ── 7. Pricing ── */}
        <BrandSection variant="paper" id="pilot-offer">
          <div className="grid lg:grid-cols-[1.1fr,0.9fr] gap-10 lg:gap-16 items-center">
            <div>
              <BrandEyebrow>Стоимость</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
                Прозрачная модель пилота
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <ul className="space-y-3 text-asi-navy/70 leading-relaxed">
                <li className="border-t border-asi-border/70 pt-3">
                  <strong className="font-semibold text-asi-navy">Подключение и настройка — 0&nbsp;₽</strong>
                  <span className="block mt-1 text-sm text-asi-navy/65">
                    Идёт до старта пилота и не расходует 14 дней.
                  </span>
                </li>
                <li className="border-t border-asi-border/70 pt-3">
                  <strong className="font-semibold text-asi-navy">14 дней реальной работы — 0&nbsp;₽</strong>
                  <span className="block mt-1 text-sm text-asi-navy/65">
                    Отсчёт только после полной технической готовности объекта.
                  </span>
                </li>
                <li className="border-t border-asi-border/70 pt-3">
                  <strong className="font-semibold text-asi-navy">
                    После пилота — {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ / объект / месяц
                  </strong>
                  <span className="block mt-1 text-sm text-asi-navy/65">
                    Только если вы решаете продолжить после отчёта.
                  </span>
                </li>
              </ul>
            </div>
            <div className="border border-asi-border bg-asi-ivory p-8 sm:p-10">
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                После решения продолжить
              </p>
              <p className="mt-4 font-serif text-5xl sm:text-6xl text-asi-navy tracking-tight">
                {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽
              </p>
              <p className="mt-3 text-asi-navy/65">за объект в месяц</p>
              <div className="mt-8">
                <BrandPrimaryCta href={PILOT_HREF}>{PRIMARY_CTA_LABEL}</BrandPrimaryCta>
              </div>
            </div>
          </div>
        </BrandSection>

        {/* ── 8. Audience ── */}
        <BrandSection variant="ivory">
          <BrandEyebrow>Аудитория</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">Кому подходит ASI</BrandHeadline>
          <div className="mt-12 grid md:grid-cols-3 gap-px bg-asi-border border border-asi-border">
            {AUDIENCE_ITEMS.map((item) => (
              <div key={item.title} className="bg-asi-paper p-7 sm:p-8">
                <h3 className="font-serif text-xl text-asi-navy">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </BrandSection>

        {/* ── Location remains secondary (product spine) ── */}
        <BrandSection variant="paper">
          <BrandEyebrow>Дополнительно</BrandEyebrow>
          <BrandHeadline className="text-2xl sm:text-3xl max-w-2xl">
            Оценка локации — отдельный инструмент
          </BrandHeadline>
          <p className="mt-4 max-w-xl text-asi-navy/65 leading-relaxed">
            Проверка адреса по спросу и окружению доступна как вспомогательный продукт и не входит в
            пилот общения с гостями.
          </p>
          <div className="mt-8">
            <BrandSecondaryCta href={RU_LOCATION_CHECK_HREF}>Оценить локацию по адресу</BrandSecondaryCta>
          </div>
        </BrandSection>

        {/* ── 9. FAQ ── */}
        <BrandSection variant="ivory" id="faq">
          <BrandEyebrow>Вопросы</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl">FAQ</BrandHeadline>
          <div className="mt-10 max-w-3xl divide-y divide-asi-border border-y border-asi-border">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left font-serif text-lg text-asi-navy marker:content-none [&::-webkit-details-marker]:hidden">
                  <span>{q}</span>
                  <span className="mt-1 shrink-0 text-asi-gold transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-asi-navy/65">{a}</p>
              </details>
            ))}
          </div>
        </BrandSection>

        {/* ── 10. Final CTA ── */}
        <BrandSection variant="navy">
          <BrandEyebrow dark>Начать</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            Подключите объект бесплатно
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-ivory/70 leading-relaxed">
            Оставьте заявку на бесплатную настройку. Мы подготовим данные объекта и начнём 14-дневный
            пилот только после полной готовности.
          </p>
          <div className="mt-9 flex flex-wrap gap-4">
            <BrandPrimaryCta href={PILOT_HREF}>{PRIMARY_CTA_LABEL}</BrandPrimaryCta>
            <BrandSecondaryCta href={HOW_HREF}>{SECONDARY_CTA_LABEL}</BrandSecondaryCta>
          </div>
        </BrandSection>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </div>
  );
}

import Link from 'next/link';
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
import {
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const PILOT_HREF = '/ru/early-access';
const CONNECT_HREF = '/connect';
const HOW_HREF = '/ru/how-it-works';
/** Secondary product: location scoring demo. */
const RU_LOCATION_CHECK_HREF = '/ru/location-analysis?mode=residential#location-check';

const NOW_ITEMS = [
  {
    title: 'Частые вопросы гостей',
    body: 'Заезд, Wi-Fi, парковка, правила объекта и бытовые уточнения — типовые обращения в цифровых каналах.',
  },
  {
    title: 'Данные вашего объекта',
    body: 'Ответы опираются на памятку, адрес и основную информацию, которую вы передаёте при подключении.',
  },
  {
    title: 'Рутинная переписка',
    body: 'Система закрывает повторяющиеся сценарии, чтобы вы не сидели постоянно в сообщениях.',
  },
  {
    title: 'Эскалация исключений',
    body: 'Нестандартные или срочные ситуации уходят человеку с контекстом переписки.',
  },
] as const;

const FLOW_STEPS = [
  {
    n: '01',
    title: 'Пилот и условия',
    body: 'Смотрите состав услуги, тариф и документы на странице пилота.',
    href: PILOT_HREF,
    label: 'Открыть пилот',
  },
  {
    n: '02',
    title: 'Заявка',
    body: 'Оставляете контакты и данные по объекту — связываемся для настройки.',
    href: `${PILOT_HREF}#pilot-form`,
    label: 'К заявке',
  },
  {
    n: '03',
    title: 'Подключение',
    body: 'После согласования входите в продукт и продолжаете настройку одного объекта.',
    href: CONNECT_HREF,
    label: 'Кабинет',
  },
] as const;

const ROADMAP_ITEMS = [
  'Синхронизация объявлений и каналов',
  'Динамическое ценообразование',
  'Координация уборок и доступов',
  'Операционная аналитика и отчётность',
] as const;

const FAQ = [
  {
    q: 'Что доступно в закрытом пилоте прямо сейчас?',
    a: 'AI-коммуникации для одного объекта на один месяц: ответы на типовые вопросы гостей. Оценка локации — отдельный инструмент.',
  },
  {
    q: 'Когда подключается человек?',
    a: 'Когда вопрос нестандартный или нужно ваше решение. Типовые сценарии система закрывает сама.',
  },
  {
    q: 'Это уже полная автоматизация объекта?',
    a: 'Нет. Полный операционный контур — направление платформы. Сейчас пилот сфокусирован на гостевой переписке.',
  },
  {
    q: 'Как подключиться?',
    a: 'Нажмите «Подключить пилот», оставьте заявку и пройдите настройку одного объекта с нашей помощью.',
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
            Рутина → ASI
          </p>
          <p className="mt-3 font-serif text-xl text-asi-navy leading-snug">
            Типовые обращения гостей — системе.
          </p>
        </div>
        <div className="bg-asi-ivory p-5 sm:p-6">
          <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
            Исключение → человек
          </p>
          <p className="mt-3 font-serif text-xl text-asi-navy leading-snug">
            Нестандартные ситуации — оператору.
          </p>
        </div>
      </div>

      <div className="mt-8 flex items-end justify-between gap-4">
        <p className="text-sm text-asi-navy/65 leading-relaxed max-w-[14rem]">
          {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ · 1 объект · 1 месяц
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
                ASI · закрытый пилот
              </p>
              <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.75rem]">
                AI-ответы гостям.
                <br />
                <span className="text-asi-gold">Человек — для исключений.</span>
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-lg leading-relaxed">
                Типовые обращения гостей — системе. Нестандартные ситуации — человеку. Для
                собственников и операторов посуточной аренды.
              </p>
              <p className="mt-4 text-sm font-sans text-asi-navy/60 tracking-wide">
                {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ · 1 объект · 1 месяц
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <BrandPrimaryCta href={PILOT_HREF}>Подключить пилот</BrandPrimaryCta>
                <BrandSecondaryCta href={HOW_HREF}>Как это работает</BrandSecondaryCta>
              </div>
            </div>
            <HeroVisual />
          </div>
        </section>

        {/* ── 2. What ASI does now ── */}
        <BrandSection variant="paper">
          <BrandEyebrow>Сейчас в пилоте</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Что ASI делает прямо сейчас
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Фокус закрытого пилота — рутинная гостевая переписка на одном объекте. Это не замена
            всего операционного контура.
          </p>
          <div className="mt-12 grid sm:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            {NOW_ITEMS.map((item) => (
              <div key={item.title} className="bg-asi-ivory p-7 sm:p-8">
                <h3 className="font-serif text-xl text-asi-navy">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </BrandSection>

        {/* ── 3. Human / AI operating model ── */}
        <BrandSection variant="navy">
          <BrandEyebrow dark>Модель работы</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            Рутина идёт автоматически.
            <br />
            Люди — на исключениях.
          </BrandHeadline>
          <div className="mt-12 grid md:grid-cols-2 gap-px bg-asi-ivory/15 border border-asi-ivory/15">
            <div className="bg-asi-navy p-8 sm:p-10">
              <span className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-soft">
                Рутина → ASI
              </span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl text-asi-ivory">Система</h3>
              <p className="mt-3 text-asi-ivory/70 leading-relaxed">
                Типовые вопросы гостей закрываются по данным объекта — без постоянного участия
                владельца в переписке.
              </p>
            </div>
            <div className="bg-asi-navy p-8 sm:p-10">
              <span className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-soft">
                Исключение → человек
              </span>
              <h3 className="mt-4 font-serif text-2xl sm:text-3xl text-asi-ivory">Оператор</h3>
              <p className="mt-3 text-asi-ivory/70 leading-relaxed">
                Нестандартные или важные ситуации передаются вам с контекстом. Решение остаётся за
                человеком.
              </p>
            </div>
          </div>
          <p className="mt-8 text-asi-ivory/60 max-w-xl leading-relaxed">
            Это модель текущего пилота AI-коммуникаций — не обещание полной автономной эксплуатации
            объекта «уже сейчас».
          </p>
        </BrandSection>

        {/* ── 4. Pilot flow ── */}
        <BrandSection variant="ivory" id="pilot-path">
          <BrandEyebrow>Путь подключения</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Один понятный путь для закрытого пилота
          </BrandHeadline>
          <ol className="mt-12 grid md:grid-cols-3 gap-0 border border-asi-border divide-y md:divide-y-0 md:divide-x divide-asi-border">
            {FLOW_STEPS.map((step) => (
              <li key={step.n} className="bg-asi-paper p-7 sm:p-8 flex flex-col">
                <span className="font-serif text-asi-gold text-2xl">{step.n}</span>
                <h3 className="mt-4 font-serif text-xl text-asi-navy">{step.title}</h3>
                <p className="mt-3 flex-1 text-sm text-asi-navy/65 leading-relaxed">{step.body}</p>
                <Link
                  href={step.href}
                  className="mt-6 inline-flex text-sm font-sans font-semibold text-asi-navy underline-offset-4 hover:underline"
                >
                  {step.label} →
                </Link>
              </li>
            ))}
          </ol>
        </BrandSection>

        {/* ── 5. Pilot offer ── */}
        <BrandSection variant="paper" id="pilot-offer">
          <div className="grid lg:grid-cols-[1.1fr,0.9fr] gap-10 lg:gap-16 items-center">
            <div>
              <BrandEyebrow>Платный MVP</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
                {COMMUNICATION_PILOT_SERVICE_TITLE}
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-asi-navy/70 leading-relaxed max-w-xl">
                Закрытый пилот AI-ответов гостям: один объект, один месяц. Оплата через ЮKassa
                подключается после модерации мерчанта — кнопка оплаты не создаёт платёж, пока
                приём отключён.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-asi-navy/65">
                <li className="border-t border-asi-border/70 pt-2">AI-ответы на частые вопросы гостей</li>
                <li className="border-t border-asi-border/70 pt-2">Настройка под данные вашего объекта</li>
                <li className="border-t border-asi-border/70 pt-2">Исключения остаются за человеком</li>
              </ul>
            </div>
            <div className="border border-asi-border bg-asi-ivory p-8 sm:p-10">
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Тариф пилота
              </p>
              <p className="mt-4 font-serif text-5xl sm:text-6xl text-asi-navy tracking-tight">
                {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽
              </p>
              <p className="mt-3 text-asi-navy/65">1 объект · 1 месяц</p>
              <div className="mt-8">
                <BrandPrimaryCta href={PILOT_HREF}>Подключить пилот</BrandPrimaryCta>
              </div>
            </div>
          </div>
        </BrandSection>

        {/* ── 6. Location secondary ── */}
        <BrandSection variant="ivory">
          <BrandEyebrow>Дополнительно</BrandEyebrow>
          <BrandHeadline className="text-2xl sm:text-3xl max-w-2xl">
            Оценка локации — отдельный инструмент
          </BrandHeadline>
          <p className="mt-4 max-w-xl text-asi-navy/65 leading-relaxed">
            Проверка адреса по спросу и окружению доступна как вспомогательный продукт. Для
            закрытого пилота AI-ответов гостям это не основной шаг.
          </p>
          <div className="mt-8">
            <BrandSecondaryCta href={RU_LOCATION_CHECK_HREF}>Оценить локацию по адресу</BrandSecondaryCta>
          </div>
        </BrandSection>

        {/* ── 7. Roadmap ── */}
        <BrandSection variant="paper">
          <BrandEyebrow>Дорожная карта платформы</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">Куда развивается ASI</BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Ниже — направление продукта, а не состав текущего пилота. Эти возможности не входят в
            тариф «1 объект / 1 месяц» как готовая услуга «уже сейчас».
          </p>
          <ul className="mt-10 grid sm:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            {ROADMAP_ITEMS.map((item) => (
              <li key={item} className="bg-asi-ivory px-6 py-5 text-sm text-asi-navy/75">
                {item}
              </li>
            ))}
          </ul>
          <Link
            href={HOW_HREF}
            className="mt-8 inline-flex text-sm font-sans font-semibold text-asi-navy underline underline-offset-4"
          >
            Подробнее о платформе и дорожной карте
          </Link>
        </BrandSection>

        {/* ── 8. FAQ ── */}
        <BrandSection variant="ivory" id="faq">
          <BrandEyebrow>Вопросы</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl">Коротко о пилоте</BrandHeadline>
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
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </div>
  );
}

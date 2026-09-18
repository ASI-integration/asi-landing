import type { Metadata } from 'next';
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
import { EarlyAccessObjectForm } from '@/components/early-access/EarlyAccessObjectForm';
import { PilotCheckoutCta } from '@/components/ru/PilotCheckoutCta';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { ruCompliance } from '@/config/ruCompliance';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

export const metadata: Metadata = {
  title: 'Пилот ASI для посуточной аренды',
  description:
    'Закрытый пилот AI-ответов гостям для владельцев посуточных объектов: 1 объект, 1 месяц, меньше ручной переписки.',
};

const FLOW_STEPS = [
  {
    n: '01',
    title: 'Гость задаёт вопрос',
    body: 'Заселение, Wi-Fi, парковка, правила объекта, заезд / выезд и бытовые вопросы.',
  },
  {
    n: '02',
    title: 'ASI отвечает по данным объекта',
    body: 'Типовой запрос закрывается по памятке и сведениям, которые вы передали при подключении.',
  },
  {
    n: '03',
    title: 'Ситуация нестандартная?',
    body: 'Срочный или нетиповой вопрос не закрывается шаблоном — нужна человеческая оценка.',
  },
  {
    n: '04',
    title: 'Подключается человек',
    body: 'Оператор получает контекст и принимает решение. Пилот не заменяет вас целиком.',
  },
] as const;

const FEATURE_GROUPS = [
  {
    label: 'Сейчас в пилоте',
    items: [
      {
        title: 'AI-ответы гостям',
        text: 'Типовые вопросы в цифровых каналах: заселение, Wi-Fi, парковка, правила, заезд и выезд.',
      },
      {
        title: 'Знание объекта',
        text: 'Ответы опираются на памятку и основную информацию, которую вы передаёте при подключении.',
      },
      {
        title: 'Рутинная переписка',
        text: 'Повторяющиеся сценарии закрываются системой — меньше ручной переписки.',
      },
      {
        title: 'Исключения — человеку',
        text: 'Срочные и нестандартные ситуации остаются за оператором с контекстом переписки.',
      },
    ],
  },
  {
    label: 'Дорожная карта',
    items: [
      {
        title: 'Каналы и объявления',
        text: 'Направление платформы: синхронизация с площадками. На пилоте публикация и импорт — вручную или полуавтоматически.',
      },
      {
        title: 'Подсказки по ценам',
        text: 'Направление платформы. Не входит в текущий тариф как автоматическое исполнение цен.',
      },
      {
        title: 'Уборки и доступы',
        text: 'Координация уборок и доступов — направление платформы, не состав текущего тарифа.',
      },
      {
        title: 'Шире операционная автоматизация',
        text: 'Полный операционный контур — дорожная карта. В пилоте фокус на гостевой переписке.',
      },
    ],
  },
] as const;

const SECURITY_ITEMS = [
  {
    n: '01',
    title: 'Без паролей площадок',
    text: 'Нам не нужны пароли от личных кабинетов Avito, Островок, Суточно.ру или Циан.',
  },
  {
    n: '02',
    title: 'Без доступа к деньгам',
    text: 'Нам не нужен доступ к вашим деньгам, расчётным счетам или картам.',
  },
  {
    n: '03',
    title: 'Данные для ответов',
    text: 'Пилот стартует с информации объекта: памятка для гостя, Wi-Fi, адрес и основные сведения. Сложные вопросы эскалируются человеку.',
  },
] as const;

const PROCESS_STEPS = [
  {
    n: '01',
    title: 'Заявка',
    body: 'Оставляете контакты и коротко описываете объекты.',
  },
  {
    n: '02',
    title: 'Собираем данные объекта',
    body: 'Вместе собираем гостевые инструкции и рабочие сведения для ответов — вручную, с сопровождением.',
  },
  {
    n: '03',
    title: 'Настраиваем ответы',
    body: 'Готовим ответы под ваш объект: типовые сценарии закрывает ASI.',
  },
  {
    n: '04',
    title: 'Запускаем пилот',
    body: 'Проверяем реальные обращения. Человек остаётся доступен для исключений.',
  },
] as const;

function HeroOfferPanel() {
  return (
    <div className="relative border border-asi-border bg-asi-paper p-6 sm:p-8 min-h-[20rem] sm:min-h-[26rem] flex flex-col justify-between">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandLogoMark size={28} />
          <span className="font-serif text-xl text-asi-navy">ASI</span>
        </div>
        <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
          Пилот
        </span>
      </div>

      <div className="mt-8">
        <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
          Тариф пилота
        </p>
        <p className="mt-4 font-serif text-5xl sm:text-6xl text-asi-navy tracking-tight">
          {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽
        </p>
        <p className="mt-3 text-asi-navy/65">1 объект · 1 месяц</p>
        <BrandGoldRule className="mt-6 mb-6" />
        <p className="text-sm text-asi-navy/70 leading-relaxed max-w-sm">
          AI-коммуникации для посуточной аренды. Типовые вопросы — системе, исключения — человеку.
        </p>
      </div>

      <div className="mt-8 flex items-end justify-between gap-4">
        <p className="text-xs font-sans uppercase tracking-[0.14em] text-asi-navy/50">
          Закрытый пилот
        </p>
        <BrandShiro size={48} />
      </div>
    </div>
  );
}

export default function RuEarlyAccessPage() {
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
              <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.5rem]">
                Типовые вопросы — системе.
                <br />
                <span className="text-asi-gold">Исключения — человеку.</span>
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-lg leading-relaxed">
                ASI отвечает на типовые вопросы гостей по данным объекта. Владелец или оператор
                подключается, когда ситуация требует решения.
              </p>
              <p className="mt-4 text-sm font-sans text-asi-navy/60 tracking-wide">
                {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ · 1 объект · 1 месяц
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <BrandPrimaryCta href="/ru/early-access#pilot-form">Подключить объект бесплатно</BrandPrimaryCta>
                <BrandSecondaryCta href="/ru/early-access#pilot-tariff">Что входит</BrandSecondaryCta>
              </div>
              <p className="mt-5 max-w-md text-sm text-asi-navy/55 leading-relaxed">
                Ограниченное число объектов — чтобы спокойно проверить сервис на реальных гостях.
              </p>
            </div>
            <HeroOfferPanel />
          </div>
        </section>

        {/* ── 2. Operating model ── */}
        <BrandSection variant="navy">
          <BrandEyebrow dark>Как проходит пилот</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            Гость задаёт вопрос.
            <br />
            ASI отвечает по данным объекта.
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-ivory/65 leading-relaxed">
            Модель текущего пилота — не полная автоматизация объекта. Исключения остаются за человеком.
          </p>
          <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-asi-ivory/15 border border-asi-ivory/15">
            {FLOW_STEPS.map((step) => (
              <li key={step.n} className="bg-asi-navy p-6 sm:p-8">
                <span className="font-serif text-asi-gold-soft text-2xl">{step.n}</span>
                <h3 className="mt-4 font-serif text-xl text-asi-ivory">{step.title}</h3>
                <p className="mt-3 text-sm text-asi-ivory/65 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </BrandSection>

        {/* ── 3. Tariff + checkout ── */}
        <BrandSection variant="paper" id="pilot-tariff">
          <div className="grid lg:grid-cols-[1.1fr,0.9fr] gap-10 lg:gap-16 items-start">
            <div>
              <BrandEyebrow>Платный MVP</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
                {COMMUNICATION_PILOT_SERVICE_TITLE}
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-asi-navy/70 leading-relaxed max-w-xl">
                {COMMUNICATION_PILOT_PAYMENT_DESCRIPTION}. Опубликованная стоимость:{' '}
                <span className="font-semibold text-asi-navy">
                  {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽
                </span>
                .
              </p>
              <ul className="mt-6 space-y-2 text-sm text-asi-navy/65">
                <li className="border-t border-asi-border/70 pt-2">
                  1 объект · 1 месяц
                </li>
                <li className="border-t border-asi-border/70 pt-2">
                  Настройка под данные конкретного объекта
                </li>
                <li className="border-t border-asi-border/70 pt-2">
                  AI-ответы на типовые вопросы гостей
                </li>
                <li className="border-t border-asi-border/70 pt-2">
                  Человек подключается к исключениям
                </li>
              </ul>
              <p className="mt-6 text-sm text-asi-navy/55 leading-relaxed max-w-xl">
                Оплата через ЮKassa подключается после модерации мерчанта. Документы:{' '}
                <Link href="/ru/payment" className="underline underline-offset-2 text-asi-navy/70">
                  оплата и доставка
                </Link>
                ,{' '}
                <Link href="/ru/offer" className="underline underline-offset-2 text-asi-navy/70">
                  оферта
                </Link>
                ,{' '}
                <Link href="/ru/refund" className="underline underline-offset-2 text-asi-navy/70">
                  возврат
                </Link>
                ,{' '}
                <Link href="/ru/privacy" className="underline underline-offset-2 text-asi-navy/70">
                  конфиденциальность
                </Link>
                ,{' '}
                <Link href="/ru/contacts" className="underline underline-offset-2 text-asi-navy/70">
                  контакты
                </Link>
                .
              </p>
              <p className="mt-4 text-sm text-asi-navy/55 leading-relaxed max-w-xl">
                Исполнитель: {ruCompliance.fullName}, ИНН {ruCompliance.inn}. Телефон:{' '}
                <a
                  href={`tel:${ruCompliance.phoneTel}`}
                  className="underline underline-offset-2 text-asi-navy/70"
                >
                  {ruCompliance.phone}
                </a>
                . Email:{' '}
                <a
                  href={`mailto:${ruCompliance.email}`}
                  className="underline underline-offset-2 text-asi-navy/70"
                >
                  {ruCompliance.email}
                </a>
                . Адрес: {ruCompliance.address}.
              </p>
            </div>
            <div className="border border-asi-border bg-asi-ivory p-7 sm:p-9">
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Оплата пилота
              </p>
              <p className="mt-4 font-serif text-5xl sm:text-6xl text-asi-navy tracking-tight">
                {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽
              </p>
              <p className="mt-2 text-asi-navy/65">1 объект · 1 месяц</p>
              <div className="mt-8">
                <PilotCheckoutCta />
              </div>
            </div>
          </div>
        </BrandSection>

        {/* ── 4. Current vs roadmap ── */}
        <BrandSection variant="ivory">
          <BrandEyebrow>Состав пилота</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Сейчас в пилоте — и куда идёт ASI
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Не смешиваем текущий тариф с дорожной картой. Полный операционный контур — направление
            платформы, а не обещание «уже сейчас».
          </p>

          <div className="mt-12 grid lg:grid-cols-2 gap-8 lg:gap-12">
            {FEATURE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                  {group.label}
                </p>
                {group.label === 'Дорожная карта' ? (
                  <h3 className="mt-3 font-serif text-2xl text-asi-navy">Дальше в ASI</h3>
                ) : (
                  <h3 className="mt-3 font-serif text-2xl text-asi-navy">В тарифе пилота</h3>
                )}
                <ul className="mt-6 divide-y divide-asi-border border-y border-asi-border">
                  {group.items.map((item) => (
                    <li key={item.title} className="py-5">
                      <h4 className="font-serif text-lg text-asi-navy">{item.title}</h4>
                      <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{item.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 border border-asi-border bg-asi-paper p-7 sm:p-8 max-w-2xl">
            <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
              Отдельный инструмент
            </p>
            <h3 className="mt-3 font-serif text-xl text-asi-navy">Оценка района и локации</h3>
            <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
              Вспомогательная проверка локации. Не входит в тариф пилота AI-коммуникаций за{' '}
              {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽.
            </p>
            <Link
              href="/ru/location-analysis?mode=residential#location-check"
              className="mt-5 inline-flex text-sm font-sans font-semibold text-asi-navy underline-offset-4 hover:underline"
            >
              Оценить локацию →
            </Link>
          </div>
        </BrandSection>

        {/* ── 5. Security ── */}
        <BrandSection variant="paper">
          <BrandEyebrow>Доступ и доверие</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-3xl">
            Без паролей площадок и без доступа к счетам
          </BrandHeadline>
          <ol className="mt-12 grid md:grid-cols-3 gap-0 border border-asi-border divide-y md:divide-y-0 md:divide-x divide-asi-border">
            {SECURITY_ITEMS.map((item) => (
              <li key={item.n} className="bg-asi-ivory p-7 sm:p-8">
                <span className="font-serif text-asi-gold text-2xl">{item.n}</span>
                <h3 className="mt-4 font-serif text-xl text-asi-navy">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{item.text}</p>
              </li>
            ))}
          </ol>
        </BrandSection>

        {/* ── 6. Process ── */}
        <BrandSection variant="navy">
          <BrandEyebrow dark>Условия пилота</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            Четыре шага до первых ответов
          </BrandHeadline>
          <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-asi-ivory/15 border border-asi-ivory/15">
            {PROCESS_STEPS.map((step) => (
              <li key={step.n} className="bg-asi-navy p-6 sm:p-8">
                <span className="font-serif text-asi-gold-soft text-2xl">{step.n}</span>
                <h3 className="mt-4 font-serif text-xl text-asi-ivory">{step.title}</h3>
                <p className="mt-3 text-sm text-asi-ivory/65 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-asi-ivory/55 max-w-xl leading-relaxed text-sm">
            Тариф пилота AI-коммуникаций — {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ за объект в месяц.
            Детали оплаты — на странице{' '}
            <Link href="/ru/payment" className="underline underline-offset-2 text-asi-ivory/75">
              оплаты
            </Link>
            .
          </p>
        </BrandSection>

        {/* ── 7. Application form ── */}
        <BrandSection variant="ivory" id="pilot-form-section">
          <BrandEyebrow>Заявка</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
            Подключить объект к пилоту
          </BrandHeadline>
          <p className="mt-5 max-w-xl text-asi-navy/70 leading-relaxed">
            Оставьте контакты — свяжемся и поможем с настройкой одного объекта.
          </p>
          <div className="mt-10 max-w-2xl">
            <EarlyAccessObjectForm />
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

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
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { ruCompliance } from '@/config/ruCompliance';

export const metadata: Metadata = {
  title: 'Подключить объект к пилоту ASI',
  description:
    'Заявка, бесплатная настройка, готовность объекта, затем 14 дней пилота. Продолжение — только по вашему решению.',
};

const PRIMARY_CTA_LABEL = 'Подключить объект бесплатно';

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
    heading: 'Что входит в пилот',
    items: [
      {
        title: 'Ответы гостям по данным объекта',
        text: 'Типовые вопросы: заселение, Wi-Fi, парковка, правила, заезд и выезд.',
      },
      {
        title: 'Знание объекта',
        text: 'Ответы опираются на информацию, которую вы передаёте при подключении.',
      },
      {
        title: 'Меньше однотипной переписки',
        text: 'Повторяющиеся сценарии закрываются системой — меньше ручной работы.',
      },
      {
        title: 'Решения — человеку',
        text: 'Срочные и нестандартные ситуации остаются за владельцем или оператором.',
      },
    ],
  },
  {
    label: 'Позже',
    heading: 'Что не входит в текущий пилот',
    items: [
      {
        title: 'Каналы и объявления',
        text: 'Направление продукта. Не входит в текущий пилот как готовая услуга.',
      },
      {
        title: 'Подсказки по ценам',
        text: 'Направление продукта. Не продаётся как автоматическое исполнение цен в текущем пилоте.',
      },
      {
        title: 'Уборки и доступы',
        text: 'Координация уборок и доступов — направление продукта, не состав текущего пилота.',
      },
      {
        title: 'Шире автоматизация объекта',
        text: 'В пилоте фокус на общении с гостями, а не на полном управлении объектом.',
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

const COMMERCIAL_STAGES = [
  {
    n: '01',
    title: 'Заявка',
    body: 'Оставляете контакты и основные данные объекта. Оплата не нужна, чтобы начать.',
  },
  {
    n: '02',
    title: 'Бесплатное подключение и настройка — 0 ₽',
    body: 'Мы заносим данные, проверяем сценарии и готовность. Этот этап не входит в 14 дней пилота.',
  },
  {
    n: '03',
    title: '14 дней реальной работы — 0 ₽',
    body: 'Отсчёт начинается только после полной готовности объекта. ASI работает на реальном объекте с реальными обращениями.',
  },
  {
    n: '04',
    title: 'После пилота — только по вашему решению',
    body: 'Сначала итоговый разбор и показ действующей цены. Автоматического перехода на оплату нет.',
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
          Как устроен старт
        </p>
        <ul className="mt-5 space-y-3 text-sm text-asi-navy/70 leading-relaxed">
          <li className="border-t border-asi-border/70 pt-3">
            <strong className="font-semibold text-asi-navy">Подключение и настройка — 0&nbsp;₽</strong>
          </li>
          <li className="border-t border-asi-border/70 pt-3">
            <strong className="font-semibold text-asi-navy">14 дней реальной работы — 0&nbsp;₽</strong>
          </li>
          <li className="border-t border-asi-border/70 pt-3">
            <strong className="font-semibold text-asi-navy">
              После пилота — только по вашему решению
            </strong>
          </li>
        </ul>
        <BrandGoldRule className="mt-6 mb-6" />
        <p className="text-sm text-asi-navy/70 leading-relaxed max-w-sm">
          14 дней отсчитываются только после полной готовности объекта. Решение о продолжении —
          после итогового разбора.
        </p>
      </div>

      <div className="mt-8 flex items-end justify-between gap-4">
        <p className="text-xs font-sans uppercase tracking-[0.14em] text-asi-navy/50">
          Заявка без оплаты
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
                ASI · подключение объекта
              </p>
              <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.5rem]">
                Заявка. Бесплатная настройка.
                <br />
                <span className="text-asi-gold">Затем 14 дней на реальном объекте.</span>
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-lg leading-relaxed">
                ASI берёт на себя повторяющиеся вопросы гостей по данным объекта. Человек подключается,
                когда нужно решение. Оплата — только если после пилота вы решите продолжить.
              </p>
              <p className="mt-4 text-sm font-sans text-asi-navy/60 tracking-wide leading-relaxed max-w-xl">
                Настройка и подключение — 0&nbsp;₽ · 14 дней после готовности — 0&nbsp;₽ · дальше только по вашему решению
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <BrandPrimaryCta href="/ru/early-access#pilot-form">{PRIMARY_CTA_LABEL}</BrandPrimaryCta>
                <BrandSecondaryCta href="/ru/early-access#pilot-path">Как устроен пилот</BrandSecondaryCta>
              </div>
              <p className="mt-5 max-w-md text-sm text-asi-navy/55 leading-relaxed">
                Оставьте заявку на бесплатную настройку. Оплата не требуется, чтобы начать пилот.
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
            Типовые вопросы закрывает система. Нестандартные ситуации остаются за человеком.
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

        {/* ── 3. Commercial chronology ── */}
        <BrandSection variant="paper" id="pilot-path">
          <div className="grid lg:grid-cols-[1.1fr,0.9fr] gap-10 lg:gap-16 items-start">
            <div>
              <BrandEyebrow>Путь пилота</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
                От заявки до решения о продолжении
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <ol className="space-y-4">
                {COMMERCIAL_STAGES.map((step) => (
                  <li key={step.n} className="border-t border-asi-border/70 pt-4">
                    <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                      {step.n}
                    </p>
                    <h3 className="mt-2 font-serif text-xl text-asi-navy">{step.title}</h3>
                    <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{step.body}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-6 text-sm text-asi-navy/55 leading-relaxed max-w-xl">
                Документы и реквизиты:{' '}
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
                Старт без оплаты
              </p>
              <p className="mt-4 font-serif text-3xl sm:text-4xl text-asi-navy leading-snug">
                Подключение объекта — бесплатно
              </p>
              <p className="mt-4 text-sm text-asi-navy/65 leading-relaxed">
                Оставьте заявку. Мы подготовим объект и начнём 14-дневный пилот только после полной
                готовности. Дальше — только при вашем решении продолжить после итогового разбора и
                подтверждения показанной цены.
              </p>
              <div className="mt-8">
                <BrandPrimaryCta href="/ru/early-access#pilot-form">{PRIMARY_CTA_LABEL}</BrandPrimaryCta>
              </div>
            </div>
          </div>
        </BrandSection>

        {/* ── 4. Current vs roadmap ── */}
        <BrandSection variant="ivory">
          <BrandEyebrow>Состав пилота</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Что входит в пилот — и что пока нет
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Не смешиваем текущий пилот с планами на будущее. В пилоте фокус на общении с гостями.
          </p>

          <div className="mt-12 grid lg:grid-cols-2 gap-8 lg:gap-12">
            {FEATURE_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                  {group.label}
                </p>
                <h3 className="mt-3 font-serif text-2xl text-asi-navy">{group.heading}</h3>
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
              Вспомогательная проверка локации. Не входит в пилот общения с гостями.
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

        {/* ── 6. Application form ── */}
        <BrandSection variant="ivory" id="pilot-form-section">
          <BrandEyebrow>Заявка</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
            Подключите объект бесплатно
          </BrandHeadline>
          <p className="mt-5 max-w-xl text-asi-navy/70 leading-relaxed">
            Оставьте контакты. Мы внесём инструкции объекта, подготовим систему и начнём 14-дневный
            пилот только после полной готовности.
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

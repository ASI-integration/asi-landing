import type { Metadata } from 'next';
import {
  BrandGoldRule,
  BrandHeadline,
  BrandLogoMark,
  BrandPrimaryCta,
  BrandSection,
  BrandShiro,
} from '@/components/brand';
import { EarlyAccessObjectForm } from '@/components/early-access/EarlyAccessObjectForm';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { COMMUNICATION_PILOT_PRICE_RUB } from '@/lib/payments/yookassa-env';

export const metadata: Metadata = {
  title: 'ASI — общение с гостями по данным объекта',
  description:
    'ASI берёт на себя однотипные вопросы гостей по данным конкретного объекта. Бесплатное подключение, 14 дней пилота после полной готовности, затем 1 000 ₽ за объект в месяц — только если решите продолжить.',
};

const FORM_HREF = '/ru#pilot-form';
const PRIMARY_CTA_LABEL = 'Подключить объект бесплатно';

const HOME_NAV_LINKS = [
  { href: '/ru#how-it-works', label: 'Как это работает' },
  { href: '/ru#example', label: 'Пример' },
  { href: '/ru#pricing', label: 'Условия' },
] as const;

const CLIENT_STEPS = [
  {
    n: '01',
    title: 'Вы оставляете заявку',
    body: 'Указываете имя, Telegram и количество объектов в управлении.',
    note: '0 ₽. Никаких карт, подписок и обязательств.',
  },
  {
    n: '02',
    title: 'Мы бесплатно настраиваем объект',
    body: 'Вы передаете правила дома, Wi-Fi, инструкции по заезду и бытовой технике. Мы вносим их в базу знаний и проверяем готовность системы.',
    note: '14 дней пилота ещё НЕ начались. Этот этап не урезает ваш тестовый период.',
  },
  {
    n: '03',
    title: 'Запуск 14 дней реальной работы',
    body: 'Отсчёт начинается только после подтверждения полной технической готовности. ASI начинает обрабатывать входящие вопросы гостей по базе знаний. Если информации недостаточно или ситуация требует решения человека — автоматический ответ останавливается, а запрос передается на проверку.',
  },
  {
    n: '04',
    title: 'Итоговый разбор пилота',
    body: 'По истечении 14 дней мы показываем, какие типовые сценарии проходили через систему, где понадобился человек и какие инструкции стоит дополнить.',
  },
  {
    n: '05',
    title: 'Вы принимаете решение',
    body: `Если вы увидели пользу и хотите продолжать — ${COMMUNICATION_PILOT_PRICE_RUB} ₽ / объект в месяц. Если нет — пилот завершается, продолжать и платить не нужно.`,
  },
] as const;

const EXAMPLES = [
  {
    title: 'Типовой запрос → Ответ по данным объекта',
    guest: '«Подскажите, пожалуйста, во сколько заезд и где парковаться?»',
    asi: '«По данным этого объекта, заезд — после 15:00. Парковка бесплатная во дворе, заезд со стороны улицы.»',
  },
  {
    title: 'Нетиповая ситуация или бизнес-решение → Передача человеку',
    guest: '«Мы можем остаться еще на одни сутки, но со скидкой 30%?»',
    asi: '«Этот вопрос требует решения управляющего. Автоматический ответ остановлен, запрос передан на проверку.»',
  },
] as const;

const PRICING_STAGES = [
  {
    title: 'Подключение и настройка — 0 ₽',
    body: 'Выполняется до старта пилота.',
  },
  {
    title: '14 дней работы на объекте — 0 ₽',
    body: 'Отсчитываются после подтверждения полной готовности.',
  },
  {
    title: `После завершения пилота — ${COMMUNICATION_PILOT_PRICE_RUB} ₽ / объект в месяц`,
    body: 'Только если клиент увидел результат и решил продолжить.',
  },
] as const;

export default function HomeRu() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader
        density="landing"
        brandLabel="ASI Global"
        showContacts={false}
        showLogin={false}
        mainLinks={HOME_NAV_LINKS}
        primaryCta={{ href: FORM_HREF, label: PRIMARY_CTA_LABEL }}
      />

      <main>
        {/* ── 1. Hero ── */}
        <section className="relative bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 overflow-hidden">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.1fr,0.9fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="flex items-center gap-3">
                <BrandLogoMark size={34} />
                <span className="font-serif text-2xl text-asi-navy">ASI Global</span>
              </div>
              <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.25rem]">
                ASI отвечает гостям вашего объекта
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-xl leading-relaxed">
                ASI берет на себя однотипные вопросы гостей по данным конкретного объекта. Человек
                подключается там, где действительно нужно решение.
              </p>
              <p className="mt-5 text-base font-serif text-asi-navy leading-snug max-w-xl">
                Больше объектов не должно означать больше людей в чатах.
              </p>
              <p className="mt-5 text-sm font-sans text-asi-navy/60 tracking-wide leading-relaxed max-w-xl">
                Настройка 0&nbsp;₽ • 14 дней пилота отсчитываются только после полной готовности •{' '}
                {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ / объект в месяц, если решите продолжить
              </p>
              <div className="mt-9">
                <BrandPrimaryCta href={FORM_HREF}>{PRIMARY_CTA_LABEL}</BrandPrimaryCta>
              </div>
            </div>
            <div className="relative border border-asi-border bg-asi-paper p-6 sm:p-8 min-h-[18rem] flex flex-col justify-between">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <BrandLogoMark size={28} />
                  <span className="font-serif text-xl text-asi-navy">ASI</span>
                </div>
                <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                  Пилот
                </span>
              </div>
              <div className="mt-8 space-y-4">
                <p className="font-serif text-2xl text-asi-navy leading-snug">
                  Типовые вопросы — по данным объекта.
                </p>
                <p className="text-sm text-asi-navy/65 leading-relaxed">
                  Нестандартные ситуации и бизнес-решения остаются за человеком.
                </p>
              </div>
              <div className="mt-8 flex justify-end">
                <BrandShiro size={56} />
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Client journey ── */}
        <BrandSection variant="paper" id="how-it-works" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Как мы подключаем ваш объект: шаг за шагом
          </BrandHeadline>
          <ol className="mt-12 grid gap-0 border border-asi-border divide-y divide-asi-border">
            {CLIENT_STEPS.map((step) => (
              <li key={step.n} className="bg-asi-ivory p-7 sm:p-8 grid sm:grid-cols-[4.5rem,1fr] gap-4 sm:gap-8">
                <span className="font-serif text-asi-gold text-2xl">{step.n}</span>
                <div>
                  <h3 className="font-serif text-xl sm:text-2xl text-asi-navy">{step.title}</h3>
                  <p className="mt-3 text-sm sm:text-base text-asi-navy/70 leading-relaxed">{step.body}</p>
                  {'note' in step && step.note ? (
                    <p className="mt-3 text-sm font-sans font-medium text-asi-navy leading-relaxed">
                      {step.note}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </BrandSection>

        {/* ── 3. Examples ── */}
        <BrandSection variant="ivory" id="example" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Как ASI работает с входящими вопросами
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-sm text-asi-navy/60 leading-relaxed">
            Ниже — примеры поведения системы, а не гарантия конкретного ответа в каждой ситуации.
          </p>
          <div className="mt-12 grid gap-px bg-asi-border border border-asi-border lg:grid-cols-2">
            {EXAMPLES.map((example) => (
              <div key={example.title} className="bg-asi-paper p-7 sm:p-8">
                <h3 className="font-serif text-xl text-asi-navy leading-snug">{example.title}</h3>
                <div className="mt-6 space-y-5">
                  <div>
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                      Гость
                    </p>
                    <p className="mt-2 text-sm text-asi-navy/75 leading-relaxed">{example.guest}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                      ASI
                    </p>
                    <p className="mt-2 text-sm text-asi-navy/75 leading-relaxed">{example.asi}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </BrandSection>

        {/* ── 4. Pricing ── */}
        <BrandSection variant="paper" id="pricing" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Простые условия запуска
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-8" />
          <ul className="max-w-3xl space-y-0 border border-asi-border divide-y divide-asi-border">
            {PRICING_STAGES.map((stage) => (
              <li key={stage.title} className="bg-asi-ivory px-6 py-6 sm:px-8 sm:py-7">
                <p className="font-serif text-xl text-asi-navy">{stage.title}</p>
                <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{stage.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-2xl text-sm text-asi-navy/65 leading-relaxed">
            Никаких скрытых платежей, списаний с оборота или автоматических продлений.
          </p>
        </BrandSection>

        {/* ── 5. Application form ── */}
        <BrandSection variant="ivory" id="pilot-form-section" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Хотите посмотреть, как это сработает на ваших объектах?
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Заполните форму — мы бесплатно соберем базу знаний вашего объекта, подключим систему и
            запустим 14 дней тест-драйва на реальном потоке гостей только после полной готовности.
          </p>
          <div className="mt-10 max-w-2xl">
            <EarlyAccessObjectForm variant="compact" submitLabel={PRIMARY_CTA_LABEL} />
          </div>
        </BrandSection>
      </main>

      <footer>
        <RuComplianceFooter tone="theme" variant="compact" />
      </footer>
    </div>
  );
}

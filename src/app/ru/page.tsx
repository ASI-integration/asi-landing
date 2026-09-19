import type { Metadata } from 'next';
import {
  BrandCard,
  BrandEyebrow,
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
    'ASI берёт на себя типовые вопросы гостей и проверку готовности объекта перед заездом — по данным конкретного объекта. Бесплатное подключение, 14 дней пилота после полной готовности, затем 1 000 ₽ за объект в месяц — только если решите продолжить.',
};

const FORM_HREF = '/ru#pilot-form';
const PRIMARY_CTA_LABEL = 'Подключить объект бесплатно';

const HOME_NAV_LINKS = [
  { href: '/ru#capabilities', label: 'Что делает ASI' },
  { href: '/ru#example', label: 'Пример' },
  { href: '/ru#pricing', label: 'Условия' },
] as const;

const CAPABILITY_GROUPS = [
  {
    title: 'Ответы гостям по данным объекта',
    body: 'ASI отвечает на типовые вопросы гостей в Telegram, используя подтверждённые данные объекта — время заезда, Wi‑Fi, парковку, бытовые правила. Всё, что требует суждения или ответственности, передаётся вам.',
  },
  {
    title: 'Проверка готовности перед заездом',
    body: 'Перед тем как выдать гостю данные для заезда, ASI проверяет два условия: объект физически готов (уборка) и в чек-листе отмечена готовность документов и депозита. Пока хотя бы одно условие не подтверждено — данные не выдаются.',
  },
  {
    title: 'Рекомендованная цена с учётом объекта',
    body: 'ASI предлагает рекомендованную цену с учётом сезона, срока до заезда, цен конкурентов и данных о локации объекта. Это рекомендация — цена не публикуется на площадках автоматически.',
  },
] as const;

const SECONDARY_CAPABILITY = {
  title: 'Личный кабинет',
  body: 'Заявки и статус пилота видны в одном месте.',
} as const;

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
    title: 'Типовой вопрос → Ответ по данным объекта',
    guest: '«Подскажите, пожалуйста, во сколько заезд и где парковаться?»',
    asi: '«По данным этого объекта заезд — после 15:00. Парковка бесплатная во дворе, заезд со стороны улицы.»',
  },
  {
    title: 'Данные для заезда → Проверка готовности',
    guest: '«Мы уже в пути, пришлите, пожалуйста, инструкции для заезда.»',
    asi: '«Проверяю готовность объекта. Как только уборка и чек-лист документов будут подтверждены, сразу пришлю инструкции.»',
  },
  {
    title: 'Нестандартная просьба → Передача человеку',
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
                ASI отвечает гостям и проверяет объект к заезду
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-xl leading-relaxed">
                ASI берёт на себя типовые вопросы гостей и рутинные проверки перед заездом — по данным
                конкретного объекта. Так постепенно снижается ручная координация в управлении объектом.
                Решения, где нужно суждение или ответственность, остаются за вами.
              </p>
              <p className="mt-5 text-base font-serif text-asi-navy leading-snug max-w-xl">
                Больше объектов не должно означать больше ручной координации.
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

        {/* ── 2. Проблема масштабирования ── */}
        <BrandSection variant="paper" id="coordination" className="scroll-mt-24">
          <BrandEyebrow>Масштабирование</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Больше объектов — больше координации, а не только больше дохода
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Каждый новый объект — это не только доход, но и новые бронирования, сообщения, задачи по
            уборке, исключения и созвоны между сотрудниками. Рост количества объектов и сотрудников не
            гарантирует пропорционального роста чистой прибыли: вместе с масштабом растёт и объём
            координации, переписки и нестандартных ситуаций.
          </p>
        </BrandSection>

        {/* ── 3. Почему отдельные автоматизации не снимают эту нагрузку целиком ── */}
        <BrandSection variant="ivory" id="automation-gap" className="scroll-mt-24">
          <BrandEyebrow>Существующая автоматизация</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Отдельные сервисы автоматизируют отдельные действия
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            На российском рынке уже есть сильные системы управления объектами и менеджеры каналов,
            которые хорошо синхронизируют бронирования, цены и календари между площадками — это реально
            работающие инструменты.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Но автоматизация отдельной функции и автоматизация решения на стыке нескольких функций —
            разные задачи. Даже когда несколько функций работают в одной системе, автоматизация связи
            между их состояниями и последующего решения — отдельная задача, которая требует собственной
            логики.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy leading-relaxed font-serif">
            Ниже — конкретный пример того, как ASI уже сегодня учитывает два условия сразу, прежде чем
            принять решение.
          </p>
        </BrandSection>

        {/* ── 4. Общение с гостями ── */}
        <BrandSection variant="paper" id="guest-communication" className="scroll-mt-24">
          <BrandEyebrow>Общение с гостями</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Самый понятный пример этой нагрузки — переписка с гостями
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Вопросы о заезде, Wi‑Fi, парковке и бытовой технике повторяются у каждого гостя. Они
            приходят в любое время суток, требуют быстрого ответа и легко приводят к ошибкам и усталости
            персонала, если отвечать на каждое сообщение вручную.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy leading-relaxed">
            Типовые вопросы по данным объекта ASI может взять на себя. Решения, которые требуют
            суждения или ответственности — скидка, конфликт, нестандартная просьба — остаются за
            человеком.
          </p>
        </BrandSection>

        {/* ── 5. Принцип ASI ── */}
        <BrandSection variant="ivory" id="principle" className="scroll-mt-24">
          <BrandEyebrow>Принцип ASI</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Рутину делает система, решения — человек
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Отдельные автоматизации выполняют отдельные действия. ASI создаётся как система, которая
            должна снижать ручную координацию между такими действиями — помогать состояниям разных
            процессов «видеть» друг друга и вместе влиять на следующий шаг.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Сегодня в ASI реально работает лишь несколько таких связей между условиями — например,
            данные для заезда не выдаются, пока не подтверждены сразу два условия: объект физически
            готов и отмечена готовность документов. Это не значит, что вся система уже связана — это
            рабочий пример того, в какую сторону она развивается.
          </p>
        </BrandSection>

        {/* ── 6. Что ASI делает сегодня ── */}
        <BrandSection variant="paper" id="capabilities" className="scroll-mt-24">
          <BrandEyebrow>Что ASI делает сегодня</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Четыре вещи, которые уже работают
          </BrandHeadline>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITY_GROUPS.map((group) => (
              <BrandCard key={group.title} className="p-7 sm:p-8">
                <h3 className="font-serif text-xl text-asi-navy leading-snug">{group.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/70 leading-relaxed">{group.body}</p>
              </BrandCard>
            ))}
          </div>
          <div className="mt-6 max-w-xl border-t border-asi-border pt-6">
            <h3 className="font-serif text-lg text-asi-navy">{SECONDARY_CAPABILITY.title}</h3>
            <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{SECONDARY_CAPABILITY.body}</p>
          </div>
        </BrandSection>

        {/* ── 7. Пример из практики ── */}
        <BrandSection variant="ivory" id="example" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Как ASI работает с входящими вопросами
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-sm text-asi-navy/60 leading-relaxed">
            Ниже — примеры поведения системы, а не гарантия конкретного ответа в каждой ситуации.
          </p>
          <div className="mt-12 grid gap-px bg-asi-border border border-asi-border lg:grid-cols-3">
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

        {/* ── 8a. Пилот: шаг за шагом ── */}
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

        {/* ── 8b. Условия и цена ── */}
        <BrandSection variant="ivory" id="pricing" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Простые условия запуска
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-8" />
          <ul className="max-w-3xl space-y-0 border border-asi-border divide-y divide-asi-border">
            {PRICING_STAGES.map((stage) => (
              <li key={stage.title} className="bg-asi-paper px-6 py-6 sm:px-8 sm:py-7">
                <p className="font-serif text-xl text-asi-navy">{stage.title}</p>
                <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{stage.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-2xl text-sm text-asi-navy/65 leading-relaxed">
            Никаких скрытых платежей, списаний с оборота или автоматических продлений.
          </p>
        </BrandSection>

        {/* ── 9. Форма заявки ── */}
        <BrandSection variant="paper" id="pilot-form-section" className="scroll-mt-24">
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

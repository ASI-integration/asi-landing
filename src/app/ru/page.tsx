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
    title: 'Ответы гостям',
    body: 'Отвечает в Telegram на типовые вопросы по данным объекта: время заезда, Wi-Fi, парковка, правила дома. Если требуется нестандартное решение — автоматический ответ останавливается, вопрос передаётся вам.',
  },
  {
    title: 'Готовность перед заездом',
    body: 'Перед отправкой инструкций ASI учитывает статус уборки и отметки в чек-листе готовности документов и депозита. Пока нужные условия не подтверждены, инструкции для заезда не открываются.',
  },
  {
    title: 'Рекомендация цены',
    body: 'Предлагает рекомендованную цену с учётом сезона, срока до заезда, конкурентных предложений и данных о локации. Цена остаётся рекомендацией и не публикуется на площадках автоматически.',
  },
] as const;

const SECONDARY_CAPABILITY = {
  title: 'Личный кабинет',
  body: 'В одном месте видны данные объекта и статус пилота.',
} as const;

const CLIENT_STEPS = [
  {
    n: '01',
    title: 'Вы оставляете заявку',
    body: 'Платить ничего не нужно.',
  },
  {
    n: '02',
    title: 'Мы бесплатно настраиваем объект',
    body: 'Собираем инструкции и данные, формируем базу знаний. В это время 14 дней пилота ещё не идут.',
  },
  {
    n: '03',
    title: 'Начинается 14-дневный пилот',
    body: 'После подтверждения полной готовности ASI обрабатывает реальные обращения гостей в Telegram по данным вашего объекта.',
  },
  {
    n: '04',
    title: 'Итоги через 14 дней',
    body: 'Показываем, какие типовые сценарии прошли через систему и где понадобился человек.',
  },
  {
    n: '05',
    title: 'Вы принимаете решение',
    body: 'Продолжать или нет — решаете сами.',
  },
] as const;

const EXAMPLES = [
  {
    title: 'Типовой вопрос → Ответ по данным объекта',
    guest: '«Здравствуйте! Где можно оставить машину и как подключиться к Wi-Fi?»',
    asi: '«Для этого объекта парковка бесплатная во дворе. Данные для подключения к Wi-Fi есть в инструкции по заезду.»',
  },
  {
    title: 'Данные для заезда → Проверка готовности',
    guest: '«Мы уже приехали. Можно получить инструкции для заезда?»',
    asi: '«Проверяю готовность объекта. Как только необходимые условия будут подтверждены, инструкции для заезда станут доступны.»',
  },
  {
    title: 'Нестандартная просьба → Передача человеку',
    guest: '«Можно завтра выехать на три часа позже? Мы готовы доплатить.»',
    asi: '«Этот вопрос требует решения управляющего. Автоматический ответ остановлен, запрос передан на проверку.»',
  },
] as const;

const PRICING_HEADLINE = `После пилота — ${COMMUNICATION_PILOT_PRICE_RUB} ₽ за объект в месяц`;

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
                Меньше ручной координации в посуточной аренде
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-xl leading-relaxed">
                ASI берёт на себя типовые вопросы гостей и проверки перед заездом. Система выполняет
                понятную рутину, а вы подключаетесь там, где нужно принять решение.
              </p>
              <p className="mt-5 text-base font-serif text-asi-navy leading-snug max-w-xl">
                Больше объектов не должно означать больше времени в чатах и ручных проверках.
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
            Почему отдельных программ уже недостаточно
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Рынок посуточной аренды уже хорошо автоматизирован. Есть сильные менеджеры каналов,
            календари и системы учёта — и они хорошо решают свои задачи.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Но автоматизировать отдельную функцию и связать несколько состояний в одно решение — не
            одно и то же. Уборка — один процесс, общение с гостем — другой, готовность документов —
            третий. ASI создаётся для того, чтобы постепенно уменьшать ручную работу между такими
            этапами.
          </p>
        </BrandSection>

        {/* ── 4. Общение с гостями ── */}
        <BrandSection variant="paper" id="guest-communication" className="scroll-mt-24">
          <BrandEyebrow>Общение с гостями</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Переписка, которая забирает время
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            «Во сколько заезд?», «Где парковаться?», «Как подключиться к Wi-Fi?» — одни и те же вопросы
            повторяются изо дня в день. Гости пишут в разное время и ждут понятного ответа.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy leading-relaxed">
            ASI берёт типовые вопросы на себя и отвечает по данным конкретного объекта. Если ситуация
            требует решения или ответственности — автоматический ответ останавливается, а запрос
            передаётся человеку.
          </p>
        </BrandSection>

        {/* ── 5. Принцип ASI ── */}
        <BrandSection variant="ivory" id="principle" className="scroll-mt-24">
          <BrandEyebrow>Принцип ASI</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Система занимается повторяемым. Человек — решениями.
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            ASI — не просто бот для ответов. Задача продукта — постепенно передавать системе те
            действия и проверки, которые она может выполнять надёжно, а человеку оставлять ситуации,
            где действительно нужно решение.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Сегодня в ASI уже работают несколько таких связей между этапами. Они позволяют передать
            системе часть повторяющейся ежедневной работы, не создавая впечатление, что автоматизация
            уже завершена там, где её ещё нет.
          </p>
        </BrandSection>

        {/* ── 6. Что ASI делает сегодня ── */}
        <BrandSection variant="paper" id="capabilities" className="scroll-mt-24">
          <BrandEyebrow>Что ASI делает сегодня</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl">
            Что умеет пилотная версия ASI
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
            Как это выглядит на практике
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-sm text-asi-navy/60 leading-relaxed">
            Примеры показывают логику работы системы. Реальные ответы зависят от правил и данных
            конкретного объекта.
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
                </div>
              </li>
            ))}
          </ol>
        </BrandSection>

        {/* ── 8b. Условия и цена ── */}
        <BrandSection variant="ivory" id="pricing" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            {PRICING_HEADLINE}
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-8" />
          <div className="max-w-3xl border border-asi-border bg-asi-paper px-6 py-6 sm:px-8 sm:py-7">
            <p className="text-base sm:text-lg text-asi-navy leading-relaxed">
              Только если вы решили продолжить. Без автоматического перехода на платный тариф.
            </p>
          </div>
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

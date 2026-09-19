import type { Metadata } from 'next';
import {
  BrandCard,
  BrandEyebrow,
  BrandGoldRule,
  BrandHeadline,
  BrandSection,
  BrandShiro,
} from '@/components/brand';
import { ConnectCta, RU_CONNECT_HREF } from '@/components/ru/ConnectCta';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { COMMUNICATION_PILOT_PRICE_RUB } from '@/lib/payments/yookassa-env';

export const metadata: Metadata = {
  title: 'ASI — рутина посуточной аренды на автопилоте',
  description:
    'ASI берёт на себя типовые вопросы гостей и проверку готовности объекта перед заездом — по данным конкретного объекта. Бесплатное подключение, 14 дней пилота после полной готовности, затем 1 000 ₽ за объект в месяц — только если решите продолжить.',
};


const HOME_NAV_LINKS = [
  { href: '/ru#capabilities', label: 'Что делает ASI' },
  { href: '/ru#how-it-works', label: 'Как подключить' },
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
  { n: '01', title: 'Укажите менеджер каналов', body: 'Bnovo, RealtyCalendar или другой сервис. Если такого сервиса нет — поможем выбрать, с чего начать.' },
  { n: '02', title: 'Выберите площадки бронирования', body: 'Отметьте, где размещены ваши объекты. Мы проверим доступные способы подключения.' },
  { n: '03', title: 'Добавьте данные объекта', body: 'Правила дома, время заезда, Wi-Fi и инструкции для гостей. Всё сохраняется в вашем кабинете.' },
  { n: '04', title: 'Запуск и проверка', body: 'Проверяем работу на вашем объекте. 14 бесплатных дней начинаются только после полной готовности.' },
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


export default function HomeRu() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader
        density="landing"
        brandLabel="ASI Global"
        showContacts={false}
        showLogin={false}
        mainLinks={HOME_NAV_LINKS}
        primaryCta={{ href: RU_CONNECT_HREF, label: 'Войти / подключить' }}
      />

      <main>
        <section className="bg-asi-ivory px-5 sm:px-8 pt-9 sm:pt-14 pb-12 sm:pb-16">
          <div className="max-w-6xl mx-auto">
            <p className="text-sm font-semibold text-asi-gold-text">Один из продуктов ASI Global</p>
            <div className="mt-5 flex items-start justify-between gap-6">
              <BrandHeadline as="h1" className="text-[2.25rem] sm:text-5xl lg:text-[3.75rem] max-w-4xl !leading-[1.08]">
                ASI сама ведёт рутину ваших объектов. От и до.
              </BrandHeadline>
              <div className="hidden sm:block shrink-0 pt-2"><BrandShiro size={80} /></div>
            </div>
            <p className="mt-6 max-w-3xl text-base sm:text-xl text-asi-navy/75 leading-relaxed">
              Календарь — в одной программе, переписка — в другой, уборка — в чате.
              ASI создаётся, чтобы связать всё это: от вопросов гостя и подготовки заезда
              до работы с площадками бронирования.
            </p>
            <p className="mt-4 text-lg sm:text-xl font-semibold">
              Система ведёт повседневные задачи. Вы решаете нестандартные вопросы.
            </p>
            <div className="mt-7 sm:mt-9"><ConnectCta /></div>
            <p className="mt-3 text-sm text-asi-navy/65">
              Сейчас — пилот: настраиваем доступные функции под ваш объект. Подключение и настройка — 0 ₽.
            </p>
          </div>
        </section>

        <BrandSection variant="paper" id="how-it-works" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl !leading-tight">
            Как запустить ASI на вашем объекте
          </BrandHeadline>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {CLIENT_STEPS.map((step) => (
              <li key={step.n} className="border-t-2 border-asi-gold pt-5">
                <span className="font-serif text-4xl text-asi-gold-text" aria-hidden="true">{step.n}</span>
                <h3 className="mt-4 text-xl sm:text-2xl font-semibold leading-tight">{step.title}</h3>
                <p className="mt-3 text-base text-asi-navy/70 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10"><ConnectCta /></div>
        </BrandSection>

        <BrandSection variant="ivory" id="pricing" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
            Специальные условия для участников группы «Стрегуново»
          </BrandHeadline>
          <dl className="mt-10 grid gap-6 sm:grid-cols-3">
            <div className="border-t border-asi-border pt-5">
              <dt className="text-base text-asi-navy/70">Подключение и настройка</dt>
              <dd className="mt-3 font-serif text-4xl sm:text-5xl">0 ₽</dd>
            </div>
            <div className="border-t border-asi-border pt-5">
              <dt className="text-base text-asi-navy/70">После полной готовности объекта</dt>
              <dd className="mt-3 font-serif text-4xl sm:text-5xl">14 дней</dd>
              <p className="mt-3 text-base">Работы бесплатно</p>
            </div>
            <div className="border-t border-asi-border pt-5">
              <dt className="text-base text-asi-navy/70">После пилота, если решите продолжить</dt>
              <dd className="mt-3 font-serif text-4xl sm:text-5xl">{COMMUNICATION_PILOT_PRICE_RUB.toLocaleString('ru-RU')} ₽</dd>
              <p className="mt-3 text-base">За объект в месяц</p>
            </div>
          </dl>
          <p className="mt-8 max-w-3xl text-lg leading-relaxed">
            Эта цена сохраняется для участника группы на 12 месяцев с момента перехода на платный режим.
            Без автоматического перехода на платный тариф.
          </p>
        </BrandSection>

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

        <BrandSection variant="paper" id="pilot-form" className="scroll-mt-24">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
            Начните с одного объекта
          </BrandHeadline>
          <p className="mt-5 text-lg text-asi-navy/70">
            Создайте кабинет, укажите ваши сервисы и добавьте данные. Мы поможем подготовить объект к запуску.
          </p>
          <div className="mt-8"><ConnectCta /></div>
        </BrandSection>
      </main>

      <footer>
        <RuComplianceFooter tone="theme" variant="compact" />
      </footer>
    </div>
  );
}

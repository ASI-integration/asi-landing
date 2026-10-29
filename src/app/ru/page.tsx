import Link from 'next/link';
import { RU_HOME_METADATA } from '@/config/ruHomeMetadata';
import {
  BrandCard,
  BrandEyebrow,
  BrandHeadline,
  BrandSection,
  BrandShiro,
} from '@/components/brand';
import { ConnectCta, RU_CONNECT_HREF } from '@/components/ru/ConnectCta';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';

export const metadata = RU_HOME_METADATA;

const HOME_NAV_LINKS = [
  { href: '/ru#capabilities', label: 'Что делает ASI' },
  { href: '/ru#how-it-works', label: 'Как подключить' },
  { href: '/ru#special-offer', label: 'Условия' },
] as const;

const CAPABILITY_GROUPS = [
  {
    title: 'Ответы гостям',
    body: 'ASI сама отвечает на частые вопросы гостей, опираясь на правила вашего объекта. А если ситуация нестандартная и нужно принять решение — система сразу передаёт диалог вам.',
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
  { n: '1', title: 'Укажите менеджер каналов', body: 'Bnovo, RealtyCalendar или другой сервис. Если такого сервиса нет — поможем выбрать, с чего начать.' },
  { n: '2', title: 'Выберите площадки бронирования', body: 'Отметьте, где размещены ваши объекты. Мы проверим доступные способы подключения.' },
  { n: '3', title: 'Добавьте данные объекта', body: 'Правила дома, время заезда, Wi-Fi и инструкции для гостей. Всё сохраняется в вашем кабинете.' },
  { n: '4', title: 'Запуск и проверка', body: 'Проверяем работу на вашем объекте. 14 бесплатных дней начинаются только после полной готовности.' },
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
    asi: '«Поздний выезд нужно согласовать. Передаю вашу просьбу управляющему.»',
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
        {/* 1. Hero */}
        <section className="bg-asi-ivory px-5 sm:px-8 pt-9 sm:pt-14 pb-2 sm:pb-3">
          <div className="max-w-6xl mx-auto">
            <p className="text-sm font-semibold text-asi-gold-text">Один из продуктов ASI Global</p>
            <div className="mt-5 flex items-start justify-between gap-6">
              <BrandHeadline as="h1" className="text-[2.25rem] sm:text-5xl lg:text-[3.75rem] max-w-4xl !leading-[1.08]">
                ASI сама ведёт рутину ваших объектов. От и до.
              </BrandHeadline>
              <div className="hidden sm:block shrink-0 pt-2"><BrandShiro size={80} /></div>
            </div>
            <p className="mt-6 max-w-3xl text-base sm:text-xl text-asi-navy/75 leading-relaxed">
              Сейчас управление объектами — это постоянное переключение: брони в одном месте, чаты с гостями в другом, задачи горничным в третьем.
            </p>
            <p className="mt-4 max-w-3xl text-base sm:text-xl text-asi-navy/75 leading-relaxed">
              <strong>ASI связывает эти процессы и ведёт их сама:</strong> ответит гостю, проверит готовность объекта к заезду и согласует детали с площадками.
            </p>
            <p className="mt-4 text-lg sm:text-xl font-semibold">
              Рутинную работу делает система. За человеком — только ключевые решения.
            </p>
            <div className="mt-7 sm:mt-9">
              <ConnectCta href={RU_CONNECT_HREF} />
            </div>
            <p className="mt-3 max-w-4xl text-[16px] sm:text-[18px] font-medium tracking-[-0.01em] text-asi-navy/80 leading-relaxed">
              Сейчас — пилот: настраиваем доступные функции под ваш объект. Подключение и настройка — 0 ₽.
            </p>
          </div>
        </section>

        {/* 2. Масштабирование */}
        <BrandSection variant="ivory" id="coordination" className="scroll-mt-24 !pt-4 sm:!pt-5 !pb-10 sm:!pb-12">
          <BrandEyebrow>Масштабирование</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
            Больше объектов не значит больше чистой прибыли
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Бытует мнение, что для роста бизнеса нужно просто набирать новые объекты. Но на практике выручка растёт, а чистая прибыль часто падает или вовсе уходит в минус.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Это классическая «ловушка масштаба», связанная с <strong>эффектом Рингельмана</strong>: чем больше людей появляется в команде (администраторы, менеджеры, координаторы), тем ниже реальная продуктивность каждого сотрудника и тем больше денег уходит на управление ими. По этой причине даже крупные отельные сети часто работают на ничтожной марже, расходуя всю прибыль на содержание раздутого штата.
          </p>
          <p className="mt-4 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            <strong>Как это решает ASI:</strong> Вам не нужно расширять штат с каждым новым объектом. Система берёт всю операционную рутину на себя, позволяя команде всего из 1–2 человек свободно управлять сетью даже в 100 и более объектов без потери качества.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 max-w-4xl">
            <div className="border-l-2 border-asi-gold pl-5 py-1">
              <p className="font-serif text-2xl sm:text-3xl leading-tight text-asi-navy">1–2 человека вместо раздутого штата</p>
            </div>
            <div className="border-l-2 border-asi-gold pl-5 py-1">
              <p className="font-serif text-2xl sm:text-3xl leading-tight text-asi-navy">управление 100+ объектами</p>
            </div>
          </div>
        </BrandSection>

        {/* 3. Первая CTA-плашка */}
        <section id="quick-connect-1" className="bg-asi-ivory px-5 sm:px-8 pb-12 sm:pb-14">
          <div className="max-w-6xl mx-auto">
            <ConnectCta
              href={RU_CONNECT_HREF}
              title="ПОПРОБОВАТЬ НА ОДНОМ ОБЪЕКТЕ"
              description="Вход или регистрация, затем настройка. На старте — 0 ₽."
            />
          </div>
        </section>

        {/* 4. Четыре шага запуска */}
        <BrandSection variant="paper" id="how-it-works" className="scroll-mt-24 !py-12 sm:!py-16">
          <BrandEyebrow>Подключение</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
            Четыре шага — и можно запускать пилот
          </BrandHeadline>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {CLIENT_STEPS.map((step) => (
              <li key={step.n} className="border-t-2 border-asi-gold pt-5">
                <span className="font-serif text-5xl sm:text-6xl lg:text-7xl leading-none text-asi-gold-text" aria-hidden="true">{step.n}</span>
                <h3 className="mt-4 text-xl sm:text-2xl font-semibold leading-tight">{step.title}</h3>
                <p className="mt-3 text-base text-asi-navy/70 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </BrandSection>

        {/* 5. Вторая CTA-плашка */}
        <section id="quick-connect-2" className="bg-asi-paper px-5 sm:px-8 pb-12 sm:pb-14">
          <div className="max-w-6xl mx-auto">
            <ConnectCta
              href={RU_CONNECT_HREF}
              title="ПЕРЕЙТИ К ПОДКЛЮЧЕНИЮ"
              description="Четыре шага — и объект готов к 14-дневному пилоту."
            />
          </div>
        </section>

        {/* 6. Почему обычных сервисов недостаточно */}
        <BrandSection variant="ivory" id="automation-gap" className="scroll-mt-24 !py-12 sm:!py-16">
          <BrandEyebrow>Существующая автоматизация</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
            Почему обычных сервисов уже недостаточно
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Рынок посуточной аренды уже хорошо автоматизирован. Есть сильные менеджеры каналов, календари и системы учёта — и они хорошо решают свои задачи. Но каждый сервис закрывает только свой участок работы.
          </p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-3 text-base sm:text-lg text-asi-navy/75 leading-relaxed">
            <li className="border-t border-asi-gold pt-4"><strong className="block text-asi-navy">Менеджер каналов</strong>Держит бронирования и календарь, но не ведёт всю операционную цепочку.</li>
            <li className="border-t border-asi-gold pt-4"><strong className="block text-asi-navy">Бот</strong>Отвечает в чате, но сам по себе не проверяет готовность объекта и не координирует остальные сервисы.</li>
            <li className="border-t border-asi-gold pt-4"><strong className="block text-asi-navy">ASI</strong>Связывает действия между сервисами и ведёт повторяемую работу объекта как единый процесс.</li>
          </ul>
        </BrandSection>

        {/* 7. Что ASI делает сегодня + примеры */}
        <BrandSection variant="paper" id="capabilities" className="scroll-mt-24 !py-12 sm:!py-16">
          <BrandEyebrow>Что ASI делает сегодня</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
            Что умеет пилотная версия ASI
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Система сама ведёт повторяемую работу объекта. Вы подключаетесь только там, где нужно нестандартное решение.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITY_GROUPS.map((group) => (
              <BrandCard key={group.title} className="p-7 sm:p-8">
                <h3 className="font-serif text-2xl text-asi-navy leading-snug">{group.title}</h3>
                <p className="mt-3 text-base text-asi-navy/70 leading-relaxed">{group.body}</p>
              </BrandCard>
            ))}
          </div>
          <div className="mt-6 max-w-xl border-t border-asi-border pt-6">
            <h3 className="font-serif text-2xl text-asi-navy">{SECONDARY_CAPABILITY.title}</h3>
            <p className="mt-2 text-base text-asi-navy/65 leading-relaxed">{SECONDARY_CAPABILITY.body}</p>
          </div>

          <Link
            href="/ru/capabilities"
            className="group mt-8 flex max-w-4xl items-center justify-between gap-6 border-y border-asi-gold/60 py-5 text-base sm:text-lg font-semibold text-asi-navy transition-colors hover:border-asi-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-asi-gold"
          >
            <span>Посмотреть все технологии, вертикали и дорожную карту ASI Global</span>
            <span className="shrink-0 text-2xl font-normal transition-transform group-hover:translate-x-1" aria-hidden="true">
              →
            </span>
          </Link>

          <div className="mt-14 sm:mt-16 border-t border-asi-border pt-10 sm:pt-12">
            <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
              Как это выглядит на практике
            </BrandHeadline>
            <p className="mt-5 max-w-2xl text-sm text-asi-navy/60 leading-relaxed">
              Примеры показывают логику работы системы. Реальные ответы зависят от правил и данных конкретного объекта.
            </p>
            <div className="mt-10 grid gap-px bg-asi-border border border-asi-border lg:grid-cols-3">
              {EXAMPLES.map((example) => (
                <div key={example.title} className="bg-asi-paper p-7 sm:p-8">
                  <h3 className="font-serif text-2xl text-asi-navy leading-snug">{example.title}</h3>
                  <div className="mt-6 space-y-5">
                    <div>
                      <p className="text-sm font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">Гость</p>
                      <p className="mt-2 text-base text-asi-navy/75 leading-relaxed">{example.guest}</p>
                    </div>
                    <div>
                      <p className="text-sm font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">ASI</p>
                      <p className="mt-2 text-base text-asi-navy/75 leading-relaxed">{example.asi}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </BrandSection>

        {/* 8. Специальные условия */}
        <BrandSection variant="ivory" id="special-offer" className="scroll-mt-24 !py-12 sm:!py-16">
          <BrandEyebrow>Специальные условия</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
            Условия для сообщества Ярослава Стригунова
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base sm:text-lg text-asi-navy/70 leading-relaxed">
            Сначала подключаем и настраиваем объект, затем даём 14 дней полноценного теста. Оплата начинается только если вы решаете продолжить.
          </p>
          <div className="mt-10 grid gap-px border border-asi-border bg-asi-border sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-asi-paper p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-asi-gold-text">Настройка</p>
              <p className="mt-3 font-serif text-3xl text-asi-navy">0 ₽</p>
              <p className="mt-3 text-sm leading-relaxed text-asi-navy/65">Подключение и настройка объекта без оплаты.</p>
            </div>
            <div className="bg-asi-paper p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-asi-gold-text">Пилот</p>
              <p className="mt-3 font-serif text-3xl text-asi-navy">14 дней</p>
              <p className="mt-3 text-sm leading-relaxed text-asi-navy/65">Бесплатный тест начинается после полной готовности объекта.</p>
            </div>
            <div className="bg-asi-paper p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-asi-gold-text">После пилота</p>
              <p className="mt-3 font-serif text-3xl text-asi-navy">1 000 ₽/объект</p>
              <p className="mt-3 text-sm leading-relaxed text-asi-navy/65">Только если вы решаете продолжить работу с ASI.</p>
            </div>
            <div className="bg-asi-paper p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-asi-gold-text">Фиксация цены</p>
              <p className="mt-3 font-serif text-3xl text-asi-navy">12 месяцев</p>
              <p className="mt-3 text-sm leading-relaxed text-asi-navy/65">Цена 1 000 ₽ за объект фиксируется на 12 месяцев.</p>
            </div>
          </div>
          <p className="mt-5 text-sm text-asi-navy/60">Никакого автоматического перехода на оплату.</p>
        </BrandSection>

        {/* 9. Финальный CTA */}
        <BrandSection variant="paper" id="pilot-form" className="scroll-mt-24 !py-12 sm:!py-16">
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl !leading-tight">
            Начните с одного объекта
          </BrandHeadline>
          <p className="mt-5 max-w-3xl text-lg text-asi-navy/70 leading-relaxed">
            Создайте кабинет, укажите ваши сервисы и добавьте данные. Мы поможем подготовить объект к запуску.
          </p>
          <div className="mt-8">
            <ConnectCta
              href={RU_CONNECT_HREF}
              title="НАСТРОИТЬ ПЕРВЫЙ ОБЪЕКТ"
              description="Вход или регистрация, затем настройка объекта."
            />
          </div>
        </BrandSection>
      </main>

      <footer>
        <RuComplianceFooter tone="theme" variant="compact" />
      </footer>
    </div>
  );
}

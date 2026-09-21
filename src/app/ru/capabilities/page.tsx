import type { Metadata } from 'next';
import {
  BrandEyebrow,
  BrandGoldRule,
  BrandHeadline,
  BrandLogoMark,
  BrandPageShell,
  BrandPrimaryCta,
  BrandSecondaryCta,
  BrandSection,
  BrandShiro,
} from '@/components/brand';
import { RU_CONNECT_HREF } from '@/components/ru/ConnectCta';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';

export const metadata: Metadata = {
  title: 'Экосистема и дорожная карта ASI Global',
  description:
    'Технологии, вертикали и направления развития ASI Global: операционная система для недвижимости, дорожная карта и автономные модули ASI Micro Lux.',
};

const PAGE_NAV_LINKS = [
  { href: '/ru/capabilities#residential', label: 'Недвижимость' },
  { href: '/ru/capabilities#roadmap', label: 'Дорожная карта' },
  { href: '/ru/capabilities#micro-lux', label: 'ASI Micro Lux' },
] as const;

const RESIDENTIAL_CAPABILITIES = [
  'Автономное общение с гостями 24/7 — текстом и голосом.',
  'Проверка готовности перед заездом и передача инструкций.',
  'Автоматическая постановка задач персоналу: клининг и ремонт.',
  'Работа поверх существующих менеджеров каналов — Bnovo, RealtyCalendar и других сервисов.',
] as const;

const ROADMAP_ITEMS = [
  {
    title: 'Динамическое ценообразование в реальном времени',
    body: 'Учёт ADR и RevPAR, плотности конкурентов, событий в радиусе 1–10 км и погоды.',
  },
  {
    title: 'Анализ локации и сегментация ЦА',
    body: 'Автоматический подбор сценариев под профиль гостя и контекст объекта.',
  },
  {
    title: 'Встроенный бесплатный Channel Manager',
    body: 'Синхронизация календарей и защита от овербукинга — бесплатно.',
  },
  {
    title: 'Автоматическая финансовая сверка',
    body: 'OTA Reconciliation и отчётность по комиссиям площадок.',
  },
  {
    title: 'Прямые повторные бронирования',
    body: 'Перевод повторных гостей с площадок в собственный контур бронирования.',
  },
  {
    title: 'Общение 24/7 с долгой памятью',
    body: 'Голосовой и текстовый диалог с сохранением контекста взаимодействия с гостем.',
  },
] as const;

export default function RuCapabilitiesPage() {
  return (
    <BrandPageShell className="font-sans">
      <RuPublicNavHeader
        density="landing"
        brandLabel="ASI Global"
        showContacts={false}
        mainLinks={PAGE_NAV_LINKS}
        primaryCta={{ href: RU_CONNECT_HREF, label: 'Войти / подключить' }}
      />

      <main>
        <section className="relative overflow-hidden bg-asi-ivory px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-20">
          <div className="mx-auto grid max-w-6xl items-end gap-12 lg:grid-cols-[1.2fr,0.8fr] lg:gap-16">
            <div>
              <div className="flex items-center gap-3">
                <BrandLogoMark size={34} />
                <span className="font-serif text-2xl text-asi-navy">ASI Global</span>
              </div>
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-asi-navy/60">
                Технологии · вертикали · развитие
              </p>
              <BrandHeadline as="h1" className="mt-8 max-w-4xl text-4xl sm:text-6xl lg:text-[4rem]">
                Экосистема и дорожная карта ASI Global
              </BrandHeadline>
              <BrandGoldRule className="mb-6 mt-7" />
              <p className="max-w-3xl text-lg leading-relaxed text-asi-navy/75 sm:text-xl">
                ASI — это управляющий операционный мозг для бизнеса, который берёт на себя всю
                рутинную работу между разными сервисами и подключает человека только там, где нужно
                решение.
              </p>
            </div>

            <div className="border border-asi-border bg-asi-paper p-7 sm:p-9">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-asi-gold-text">
                Одна архитектура
              </p>
              <p className="mt-4 font-serif text-2xl leading-snug text-asi-navy sm:text-3xl">
                Софт для операций сегодня. Физические продукты и новые технологии — следующий слой.
              </p>
              <div className="mt-8 flex items-end justify-between gap-6 border-t border-asi-border pt-6">
                <p className="max-w-[15rem] text-sm leading-relaxed text-asi-navy/60">
                  От одного объекта до распределённой сети без разрастания ручного управления.
                </p>
                <BrandShiro size={52} />
              </div>
            </div>
          </div>
        </section>

        <BrandSection variant="paper" id="residential" className="scroll-mt-24">
          <div className="grid gap-12 lg:grid-cols-[0.8fr,1.2fr] lg:gap-16">
            <div>
              <BrandEyebrow>Вертикаль 01 · Софт</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl">
                ASI для жилой и посуточной недвижимости
              </BrandHeadline>
              <p className="mt-6 leading-relaxed text-asi-navy/70">
                ASI связывает данные объекта, бронирования, сообщения гостей и работу персонала в
                единый операционный процесс поверх уже используемых сервисов.
              </p>
            </div>

            <div>
              <ul className="grid gap-px border border-asi-border bg-asi-border sm:grid-cols-2">
                {RESIDENTIAL_CAPABILITIES.map((item, index) => (
                  <li key={item} className="bg-asi-ivory p-6 sm:p-7">
                    <span className="text-xs font-semibold tracking-[0.18em] text-asi-gold-text">
                      0{index + 1}
                    </span>
                    <p className="mt-4 text-base leading-relaxed text-asi-navy/75">{item}</p>
                  </li>
                ))}
              </ul>
              <div className="border-x border-b border-asi-gold/50 bg-asi-ivory p-7 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                  Главный эффект
                </p>
                <p className="mt-4 font-serif text-2xl leading-snug text-asi-navy sm:text-3xl">
                  Команда из 1–2 человек управляет сеткой в 50–100+ объектов без раздувания штата.
                </p>
              </div>
            </div>
          </div>
        </BrandSection>

        <BrandSection variant="navy" id="roadmap" className="scroll-mt-24">
          <BrandEyebrow dark>Ключевые технологии</BrandEyebrow>
          <BrandHeadline className="max-w-4xl text-3xl text-asi-ivory sm:text-5xl">
            Дорожная карта единой операционной системы
          </BrandHeadline>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-asi-ivory/65 sm:text-lg">
            Это направления развития ASI Global. Они отделены от возможностей текущего пилота и не
            являются обещанием конкретных сроков запуска.
          </p>
          <ol className="mt-12 grid gap-px border border-asi-ivory/15 bg-asi-ivory/15 md:grid-cols-2 lg:grid-cols-3">
            {ROADMAP_ITEMS.map((item, index) => (
              <li key={item.title} className="bg-asi-navy p-6 sm:p-8">
                <span className="font-serif text-4xl text-asi-gold-soft/80">0{index + 1}</span>
                <h3 className="mt-6 font-serif text-xl leading-snug text-asi-ivory sm:text-2xl">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-asi-ivory/55 sm:text-base">{item.body}</p>
              </li>
            ))}
          </ol>
        </BrandSection>

        <BrandSection variant="ivory" id="micro-lux" className="scroll-mt-24">
          <div className="grid items-stretch gap-10 lg:grid-cols-[1fr,1fr] lg:gap-16">
            <div>
              <BrandEyebrow>Вертикаль 02 · Физический продукт</BrandEyebrow>
              <BrandHeadline className="text-4xl sm:text-6xl">ASI Micro Lux</BrandHeadline>
              <BrandGoldRule className="mb-7 mt-7" />
              <p className="max-w-xl text-lg leading-relaxed text-asi-navy/70">
                Отдельная физическая вертикаль ASI Global: компактные модульные пространства для
                краткосрочного проживания в дорогих локациях с высоким спросом на размещение — там,
                где классический номер дорог, а бюджетные форматы не дают достаточной приватности.
              </p>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-asi-navy/70">
                Формат задуман как конкурентная альтернатива не только отелям, но и хостелам:
                меньше пространства на одного гостя, но собственная приватная среда и высокий
                уровень автоматизации.
              </p>
            </div>

            <div className="flex min-h-[20rem] flex-col justify-between bg-asi-navy p-8 text-asi-ivory sm:p-10">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-asi-gold-soft">
                  ASI внутри модуля
                </p>
                <p className="mt-5 font-serif text-2xl leading-snug sm:text-3xl">
                  ASI — управляющий слой Micro Lux
                </p>
                <p className="mt-5 leading-relaxed text-asi-ivory/65">
                  В этой вертикали ASI проектируется как единый управляющий слой для бронирования,
                  доступа, обслуживания и операционных задач модуля.
                </p>
                <p className="mt-5 text-sm leading-relaxed text-asi-ivory/50">
                  Micro Lux находится на более ранней стадии развития, чем текущая программная
                  вертикаль ASI для недвижимости.
                </p>
              </div>
              <div className="mt-10 flex justify-end">
                <BrandShiro size={56} />
              </div>
            </div>
          </div>
        </BrandSection>

        <BrandSection variant="paper" id="intellectual-property" className="scroll-mt-24">
          <div className="grid gap-10 lg:grid-cols-[0.7fr,1.3fr] lg:gap-16">
            <div>
              <BrandEyebrow>Защита ИС</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl">Патентование архитектуры</BrandHeadline>
            </div>
            <div className="border-l-2 border-asi-gold pl-6 sm:pl-8">
              <p className="font-serif text-2xl leading-snug text-asi-navy sm:text-3xl">
                Архитектура процессов и физических модулей находится в процессе патентования.
              </p>
              <p className="mt-5 text-base leading-relaxed text-asi-navy/70 sm:text-lg">
                Поданы заявки в Роспатент, готовится международная процедура PCT.
              </p>
            </div>
          </div>
        </BrandSection>

        <BrandSection variant="ivory">
          <div className="grid items-end gap-10 lg:grid-cols-[1.2fr,0.8fr] lg:gap-16">
            <div>
              <BrandEyebrow>Точка входа</BrandEyebrow>
              <BrandHeadline className="max-w-3xl text-3xl sm:text-5xl">
                Начните с программной вертикали на одном объекте
              </BrandHeadline>
              <p className="mt-6 max-w-2xl leading-relaxed text-asi-navy/70">
                Подключение начинается с данных объекта и доступных интеграций. Текущие возможности
                пилота остаются отделены от долгосрочной дорожной карты.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 lg:justify-end">
              <BrandPrimaryCta href={RU_CONNECT_HREF}>Начать подключение</BrandPrimaryCta>
              <BrandSecondaryCta href="/ru#capabilities">Возможности пилота</BrandSecondaryCta>
            </div>
          </div>
        </BrandSection>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </BrandPageShell>
  );
}

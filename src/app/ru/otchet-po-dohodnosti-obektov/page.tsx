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
import { RuLocationProductNav } from '@/components/ru/RuLocationProductNav';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { LOCATION_REPORT_PRODUCT_PATH } from '@/lib/location/report-state';

export const metadata: Metadata = {
  title: 'Отчёт по доходности объекта по адресу — ASI',
  description:
    'Проверка потенциала дохода по адресу до покупки, аренды или запуска: спрос рядом, конкуренция, сильные стороны, риски и что уточнить перед решением.',
};

const EXPRESS_ASSESSMENT_HREF = '/ru/location-analysis?mode=residential#location-check';
const METHODOLOGY_HREF = '/ru/kak-my-ocenivaem-dohodnost-obektov';

const REPORT_BLOCKS = [
  {
    title: 'Потенциал дохода',
    text: 'Ориентир по выручке диапазоном, без обещаний точного дохода.',
  },
  {
    title: 'Спрос рядом',
    text: 'Кто может бронировать объект: командированные, туристы, семьи, медтуризм или смешанный спрос.',
  },
  {
    title: 'Конкуренция',
    text: 'Насколько плотно вокруг предложение похожих объектов и что это значит для загрузки и цены.',
  },
  {
    title: 'Магниты и инфраструктура',
    text: 'Транспорт, медицина, университеты, туризм и локальные точки притяжения вокруг.',
  },
  {
    title: 'Риски и рекомендации',
    text: 'Факторы, которые важно проверить заранее, и пошаговый план перед решением.',
  },
] as const;

const WHY_CARDS = [
  {
    title: 'Оценить потенциал до вложений',
    text: 'Понять спрос, конкуренцию и риски до сделки, запуска или ремонта.',
  },
  {
    title: 'Не переплатить за аренду',
    text: 'Понять, соответствует ли запрашиваемая цена реальным арендным ставкам в этом районе.',
  },
  {
    title: 'Понять спрос до запуска',
    text: 'Определить, какая модель принесет больше денег именно здесь: посуточная или среднесрочная аренда.',
  },
  {
    title: 'Увидеть риски заранее',
    text: 'Заранее выявить скрытую сезонность, жесткую конкуренцию и другие подводные камни локации.',
  },
] as const;

const OBJECT_TYPES = [
  'квартиры',
  'апартаменты',
  'мини-отели',
  'апарт-отели',
  'портфели из нескольких объектов',
] as const;

export default function OtchetPoDohodnostiPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader density="landing" />

      <main>
        <section className="relative bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 overflow-hidden">
          <div className="max-w-6xl mx-auto">
            <RuLocationProductNav currentPath={LOCATION_REPORT_PRODUCT_PATH} />
            <div className="grid lg:grid-cols-[1.15fr,0.85fr] gap-12 lg:gap-16 items-center">
              <div>
                <div className="flex items-center gap-3">
                  <BrandLogoMark size={34} />
                  <span className="font-serif text-2xl text-asi-navy">ASI</span>
                </div>
                <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                  Оценка локации · отдельный инструмент
                </p>
                <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.5rem]">
                  Оцените потенциал объекта
                  <br />
                  <span className="text-asi-gold">до вложений.</span>
                </BrandHeadline>
                <BrandGoldRule className="mt-6 mb-6" />
                <p className="text-lg text-asi-navy/70 max-w-xl leading-relaxed">
                  Спрос, конкуренция, инфраструктура и риски по одному адресу. Потенциал дохода —
                  как диапазон и ориентир, без обещания гарантированной выручки.
                </p>
                <div className="mt-9 flex flex-wrap gap-4">
                  <BrandPrimaryCta href={EXPRESS_ASSESSMENT_HREF}>
                    Оценить объект по адресу
                  </BrandPrimaryCta>
                  <BrandSecondaryCta href={METHODOLOGY_HREF}>Как считается оценка</BrandSecondaryCta>
                </div>
                <p className="mt-5 max-w-md text-sm text-asi-navy/55 leading-relaxed">
                  Бесплатный предпросмотр даёт общий вывод. Подробный отчёт открывается через личный
                  кабинет.
                </p>
              </div>

              <aside className="border border-asi-border bg-asi-paper p-6 sm:p-8">
                <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                  Что внутри отчёта
                </p>
                <h2 className="mt-3 font-serif text-2xl text-asi-navy leading-snug">
                  Данные для решения перед покупкой, арендой или запуском
                </h2>
                <ul className="mt-6 divide-y divide-asi-border border-y border-asi-border">
                  {[
                    'Итоговый вывод по лучшему сценарию для объекта.',
                    'Аудитория спроса: командированные, туристы, семьи, медтуризм или смешанный спрос.',
                    'Сигналы спроса, конкуренция и риски окружения.',
                    'Что проверить вручную перед оплатой аренды, покупкой или запуском.',
                  ].map((label) => (
                    <li key={label} className="py-3 text-sm text-asi-navy/70 leading-relaxed">
                      {label}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm text-asi-navy/55 leading-relaxed">
                  Анализ на основе рыночных данных. Мы не обещаем доход. Мы даём цифры и статистику,
                  чтобы вы не принимали решение вслепую.
                </p>
              </aside>
            </div>
          </div>
        </section>

        <BrandSection variant="paper">
          <BrandEyebrow>Зачем нужен отчёт</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-3xl">
            Снижаете риск ошибиться до сделки или запуска
          </BrandHeadline>
          <div className="mt-12 grid sm:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            {WHY_CARDS.map((card) => (
              <div key={card.title} className="bg-asi-ivory p-7 sm:p-8">
                <h3 className="font-serif text-xl text-asi-navy">{card.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{card.text}</p>
              </div>
            ))}
          </div>
        </BrandSection>

        <BrandSection variant="navy">
          <BrandEyebrow dark>Что показывает отчёт</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-3xl text-asi-ivory">
            Пять блоков для решения по локации
          </BrandHeadline>
          <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-5 gap-px bg-asi-ivory/15 border border-asi-ivory/15">
            {REPORT_BLOCKS.map((item, index) => (
              <li key={item.title} className="bg-asi-navy p-5 sm:p-6">
                <span className="font-serif text-asi-gold-soft text-2xl">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-4 font-serif text-lg text-asi-ivory">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-ivory/65 leading-relaxed">{item.text}</p>
              </li>
            ))}
          </ol>
        </BrandSection>

        <BrandSection variant="ivory">
          <BrandEyebrow>Для каких объектов</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-2xl">
            Подходит для разных форматов размещения
          </BrandHeadline>
          <p className="mt-5 max-w-xl text-asi-navy/65 leading-relaxed">
            Помогает оценить потенциал перед покупкой, арендой или запуском, а также найти точки
            роста для уже работающей локации.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {OBJECT_TYPES.map((label) => (
              <li
                key={label}
                className="border border-asi-border bg-asi-paper px-4 py-2 text-sm text-asi-navy/75"
              >
                {label}
              </li>
            ))}
          </ul>
        </BrandSection>

        <BrandSection variant="paper">
          <div className="grid lg:grid-cols-[1.2fr,0.8fr] gap-10 lg:gap-16 items-center">
            <div>
              <BrandEyebrow>Следующий шаг</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
                Начните с бесплатной оценки по адресу
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-asi-navy/70 leading-relaxed max-w-xl">
                Сначала проверьте адрес бесплатно. Подробный отчёт поможет увидеть спрос, риски и
                точки роста до покупки, запуска, ремонта или подключения управления.
              </p>
              <p className="mt-4 text-sm text-asi-navy/55 leading-relaxed max-w-xl">
                Расчёт не обещает гарантированный доход. Итог зависит от качества данных, состояния
                объекта, сезона, цены, каналов продаж и управления.
              </p>
              <div className="mt-8">
                <BrandPrimaryCta href={EXPRESS_ASSESSMENT_HREF}>
                  Оценить объект по адресу
                </BrandPrimaryCta>
              </div>
            </div>
            <div className="border border-asi-border bg-asi-ivory p-8 flex flex-col justify-between min-h-[12rem]">
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Отдельный инструмент
              </p>
              <p className="mt-4 font-serif text-xl text-asi-navy leading-snug">
                Оценка локации не входит в пилот AI-коммуникаций за 1000&nbsp;₽.
              </p>
              <div className="mt-8 flex justify-end">
                <BrandShiro size={48} />
              </div>
            </div>
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

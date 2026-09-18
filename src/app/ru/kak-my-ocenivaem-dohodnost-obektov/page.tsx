import Link from 'next/link';
import type { Metadata } from 'next';
import {
  BrandEyebrow,
  BrandGoldRule,
  BrandHeadline,
  BrandLogoMark,
  BrandPrimaryCta,
  BrandSecondaryCta,
  BrandSection,
} from '@/components/brand';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuLocationProductNav } from '@/components/ru/RuLocationProductNav';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { LOCATION_REPORT_PRODUCT_PATH, LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

export const metadata: Metadata = {
  title: 'Как мы оцениваем доходность объектов — ASI',
  description:
    'Методология оценки доходности объектов посуточной аренды: данные, отраслевые метрики и подход к анализу локации, спроса и конкурентной среды.',
};

const PRODUCT_HREF = LOCATION_REPORT_PRODUCT_PATH;
const SAMPLE_REPORT_HREF = LOCATION_REPORT_SAMPLE_PATH;
const ANALYSIS_HREF = '/ru/location-analysis?mode=residential#location-check';
const METHODOLOGY_PATH = '/ru/kak-my-ocenivaem-dohodnost-obektov';

const DATA_FACTORS = [
  { n: '01', label: 'Локация и адрес', desc: 'Район, тип застройки, характер зоны.' },
  { n: '02', label: 'Транспортная доступность', desc: 'Метро, остановки, расстояния.' },
  {
    n: '03',
    label: 'Точки притяжения спроса',
    desc: 'Деловые центры, вузы, достопримечательности, торговые зоны.',
  },
  {
    n: '04',
    label: 'Плотность конкуренции',
    desc: 'Сколько объектов аренды в радиусе 500 м и 1 км.',
  },
  {
    n: '05',
    label: 'Типы объектов рядом',
    desc: 'Квартиры, апартаменты, мини-отели — как это влияет на ценовой уровень зоны.',
  },
  {
    n: '06',
    label: 'Сезонные факторы',
    desc: 'Колебания спроса по месяцам и событийные пики.',
  },
  {
    n: '07',
    label: 'Климатические модификаторы',
    desc: 'Как погода и сезон влияют на поток гостей в локации.',
  },
  {
    n: '08',
    label: 'Структура спроса',
    desc: 'Туризм, командировки, медицинский туризм, учёба — что преобладает в вашей зоне.',
  },
  {
    n: '09',
    label: 'Типы аудитории',
    desc: 'Кто приезжает — семьи, одиночки, бизнес-путешественники — и как это влияет на цену и срок.',
  },
  {
    n: '10',
    label: 'Устойчивый vs тактический спрос',
    desc: 'Разница между постоянным спросом и временными пиками — важна для прогноза.',
  },
] as const;

const METRICS = [
  {
    abbr: 'ADR',
    full: 'Average Daily Rate',
    ru: 'Средний доход за проданную ночь',
    desc: 'Показывает, сколько в среднем платит гость за одну ночь в объектах вашей зоны.',
    formula: 'ADR = Выручка от размещения / Количество проданных ночей',
    usage:
      'Используем для оценки ценового уровня локации и сегмента объекта. Анализируем в связке с загрузкой, сезонностью и конкурентной средой — сам по себе ADR не говорит об эффективности.',
  },
  {
    abbr: 'RevPAR',
    full: 'Revenue per Available Room',
    ru: 'Доход на один доступный номер',
    desc: 'Учитывает и цену, и загрузку одновременно — более полная картина, чем просто ADR.',
    formula: 'RevPAR = ADR × Occupancy  или  RevPAR = Выручка / Доступные номеро-ночи',
    usage:
      'Одна из базовых рыночных метрик. Показывает, насколько эффективно объект генерирует доход с учётом незаполненных ночей. Не рассматриваем её как единственный источник истины.',
  },
  {
    abbr: 'Occupancy',
    full: 'Occupancy Rate',
    ru: 'Загрузка объекта',
    desc: 'Какой процент ночей объект был занят за период.',
    formula: 'Occupancy = Проданные ночи / Доступные ночи × 100%',
    usage:
      'Ключевой индикатор востребованности локации. Анализируем в динамике и в сравнении с типичной загрузкой аналогичных объектов в зоне.',
  },
  {
    abbr: 'LOS',
    full: 'Length of Stay',
    ru: 'Средняя длина пребывания',
    desc: 'Сколько ночей в среднем остаются гости в объектах вашей зоны.',
    formula: 'LOS = Общее количество ночей / Количество бронирований',
    usage:
      'Влияет на операционную нагрузку и оптимальную ценовую стратегию. Короткие LOS — высокая оборачиваемость, длинные — стабильность без частых смен.',
  },
  {
    abbr: 'GOPPAR',
    full: 'Gross Operating Profit per Available Room',
    ru: 'Валовая операционная прибыль на доступный номер',
    desc: 'Показывает не просто выручку, а то, сколько объект реально приносит с учётом операционных расходов.',
    formula: 'GOPPAR = Валовая операционная прибыль / Количество доступных номеров',
    usage:
      'Рассматриваем как ориентир реальной прибыльности, а не только объёма бронирований. Помогает не переоценивать локации с высокой выручкой, но слабой экономикой.',
  },
  {
    abbr: 'TRevPAR',
    full: 'Total Revenue per Available Room',
    ru: 'Совокупный доход на доступный номер',
    desc: 'Расширенная версия RevPAR — учитывает все источники дохода, а не только размещение.',
    formula: 'TRevPAR = Совокупная выручка / Количество доступных номеров',
    usage:
      'Используем для оценки полного потенциала объекта с дополнительными услугами — поздний выезд, питание, трансфер.',
  },
  {
    abbr: 'NRevPAR',
    full: 'Net Revenue per Available Room',
    ru: 'Чистый доход на доступный номер',
    desc: 'RevPAR после вычета комиссий площадок и прямых затрат на дистрибуцию.',
    formula: 'NRevPAR = (Выручка − Комиссии − Затраты на дистрибуцию) / Доступные номеро-ночи',
    usage:
      'Важен для сравнения объектов с разной структурой каналов продаж. Показывает реальную отдачу, а не валовую выручку.',
  },
  {
    abbr: 'Booking Window',
    full: 'Booking Window',
    ru: 'Период опережения бронирования',
    desc: 'За сколько дней до заезда гости обычно бронируют объекты в вашей зоне.',
    formula: 'Медиана или среднее: дата бронирования → дата заезда',
    usage:
      'Помогает понять характер спроса в локации: туристический (бронируют заранее) или деловой (бронируют за 1–3 дня). Влияет на ценовую стратегию и управление доступностью.',
  },
  {
    abbr: 'MPI',
    full: 'Market Penetration Index',
    ru: 'Индекс проникновения на рынок',
    desc: 'Показывает, насколько доля объекта в загрузке соответствует его доле в предложении зоны.',
    formula: 'MPI = Occupancy объекта / Occupancy конкурентного сета × 100',
    usage:
      'MPI > 100 означает, что объект занимает непропорционально большую долю рынка. Используем как один из индикаторов конкурентной позиции в локации.',
  },
] as const;

export default function KakMyOcenivaemPage() {
  return (
    <div className="font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader density="landing" />

      <main>
        <section className="bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-20">
          <div className="max-w-6xl mx-auto">
            <RuLocationProductNav currentPath={METHODOLOGY_PATH} />
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <BrandLogoMark size={28} />
                <span className="font-serif text-lg text-asi-navy">ASI</span>
              </div>
              <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                Методология
              </p>
              <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl">
                Как мы оцениваем доходность объектов
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 leading-relaxed">
                Мы используем открытые данные, отраслевые метрики и собственную модель оценки, чтобы
                показать вероятный потенциал, ограничения и вопросы, которые нужно проверить по
                конкретному объекту.
              </p>
              <Link
                href={PRODUCT_HREF}
                className="mt-6 inline-flex text-sm font-sans font-semibold text-asi-navy underline-offset-4 hover:underline"
              >
                ← К оценке объекта
              </Link>
            </div>
          </div>
        </section>

        <BrandSection variant="paper">
          <BrandEyebrow>Данные</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-3xl">
            Какие данные мы учитываем
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/65 leading-relaxed">
            Каждый фактор влияет на итоговую доходность — мы разбираем их в связке, а не по
            отдельности.
          </p>
          <ul className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-asi-border border border-asi-border">
            {DATA_FACTORS.map((f) => (
              <li key={f.label} className="bg-asi-ivory p-6 sm:p-7">
                <span className="font-serif text-asi-gold text-xl">{f.n}</span>
                <h3 className="mt-3 font-serif text-lg text-asi-navy">{f.label}</h3>
                <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{f.desc}</p>
              </li>
            ))}
          </ul>
        </BrandSection>

        <BrandSection variant="ivory">
          <BrandEyebrow>Метрики</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-3xl">
            Отраслевые метрики
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/65 leading-relaxed">
            Стандартные гостиничные показатели — основа любого серьёзного анализа. Ниже — что каждый
            из них означает и как мы его применяем.
          </p>
          <div className="mt-12 space-y-0 border-y border-asi-border divide-y divide-asi-border">
            {METRICS.map((m) => (
              <article key={m.abbr} className="py-8 sm:py-10">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-serif text-2xl text-asi-navy">{m.abbr}</span>
                  <span className="text-sm text-asi-navy/45">{m.full}</span>
                  <span className="text-sm text-asi-navy/70">— {m.ru}</span>
                </div>
                <p className="mt-3 max-w-3xl text-sm text-asi-navy/70 leading-relaxed">{m.desc}</p>
                <div className="mt-5 grid lg:grid-cols-2 gap-6 max-w-4xl">
                  <div>
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-gold-text">
                      Формула
                    </p>
                    <pre className="mt-2 whitespace-pre-wrap break-words border border-asi-border bg-asi-paper px-4 py-3 text-xs font-mono text-asi-navy leading-relaxed">
                      {m.formula}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-gold-text">
                      Как мы используем
                    </p>
                    <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{m.usage}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </BrandSection>

        <BrandSection variant="navy">
          <BrandEyebrow dark>Ограничения</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-3xl text-asi-ivory">
            Почему одних гостиничных метрик недостаточно
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-ivory/65 leading-relaxed">
            Классические метрики полезны и обязательны — без них анализ не имеет основания. Но они
            не объясняют полностью, почему один объект зарабатывает больше другого в той же зоне.
          </p>
          <p className="mt-4 max-w-2xl text-asi-ivory/65 leading-relaxed">
            ADR и RevPAR показывают результат — но не причину. Два объекта с одинаковым RevPAR могут
            иметь принципиально разные перспективы.
          </p>
          <ul className="mt-10 max-w-2xl divide-y divide-asi-ivory/15 border-y border-asi-ivory/15">
            {[
              'Структуру спроса — устойчивый он или тактический',
              'Тип аудитории и как это влияет на срок и цену',
              'Близость к постоянным драйверам: деловые центры, вузы, медицина',
              'Давление конкуренции и ценовой диапазон зоны',
              'Различие между первичным и вторичным спросом в локации',
            ].map((item) => (
              <li key={item} className="py-3 text-sm text-asi-ivory/75">
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-2xl text-sm text-asi-ivory/55 leading-relaxed italic">
            Мы опираемся на общепринятые рыночные показатели, но дополняем их более глубокой оценкой
            локации, структуры спроса и конкурентного давления. Это помогает отделять адресные
            сигналы от общих средних значений и честно показывать ограничения данных.
          </p>
        </BrandSection>

        <BrandSection variant="paper">
          <BrandEyebrow>Следующий шаг</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-2xl">
            Отчёт нужен до любого решения по объекту
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-6" />
          <p className="max-w-xl text-asi-navy/70 leading-relaxed">
            Проверьте спрос, риски и сценарии монетизации до покупки, запуска или подключения
            управления. Итог зависит от качества данных, объекта, сезона, каналов и управления.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <BrandPrimaryCta href={SAMPLE_REPORT_HREF}>Посмотреть пример отчёта</BrandPrimaryCta>
            <BrandSecondaryCta href={ANALYSIS_HREF}>Оценить объект по адресу</BrandSecondaryCta>
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

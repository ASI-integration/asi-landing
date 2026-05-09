import Link from 'next/link';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { TgIcon } from '@/components/TgIcon';

export const metadata: Metadata = {
  title: 'Как мы оцениваем доходность объектов — ASI',
  description:
    'Методология оценки доходности объектов посуточной аренды: данные, отраслевые метрики и подход к анализу локации, спроса и конкурентной среды.',
};

const PRODUCT_HREF  = '/ru/otchet-po-dohodnosti-obektov';
const REPORT_CTA_HREF = 'https://t.me/ASI_core_bot';

/* ─── Data factors ────────────────────────────────────────────────────────── */
const DATA_FACTORS = [
  { icon: '📍', label: 'Локация и адрес', desc: 'Район, тип застройки, характер зоны.' },
  { icon: '🚇', label: 'Транспортная доступность', desc: 'Метро, остановки, расстояния.' },
  { icon: '🏛️', label: 'Точки притяжения спроса', desc: 'Деловые центры, вузы, достопримечательности, торговые зоны.' },
  { icon: '🏘️', label: 'Плотность конкуренции', desc: 'Сколько объектов аренды в радиусе 500 м и 1 км.' },
  { icon: '🏷️', label: 'Типы объектов рядом', desc: 'Квартиры, апартаменты, мини-отели — как это влияет на ценовой уровень зоны.' },
  { icon: '📅', label: 'Сезонные факторы', desc: 'Колебания спроса по месяцам и событийные пики.' },
  { icon: '🌤️', label: 'Климатические модификаторы', desc: 'Как погода и сезон влияют на поток гостей в локации.' },
  { icon: '🎯', label: 'Структура спроса', desc: 'Туризм, командировки, медицинский туризм, учёба — что преобладает в вашей зоне.' },
  { icon: '👥', label: 'Типы аудитории', desc: 'Кто приезжает — семьи, одиночки, бизнес-путешественники — и как это влияет на цену и срок.' },
  { icon: '📊', label: 'Устойчивый vs тактический спрос', desc: 'Разница между постоянным спросом и временными пиками — важна для прогноза.' },
];

/* ─── Industry metrics ────────────────────────────────────────────────────── */
const METRICS = [
  {
    abbr: 'ADR',
    full: 'Average Daily Rate',
    ru: 'Средний доход за проданную ночь',
    desc: 'Показывает, сколько в среднем платит гость за одну ночь в объектах вашей зоны.',
    formula: 'ADR = Выручка от размещения / Количество проданных ночей',
    usage: 'Используем для оценки ценового уровня локации и сегмента объекта. Анализируем в связке с загрузкой, сезонностью и конкурентной средой — сам по себе ADR не говорит об эффективности.',
  },
  {
    abbr: 'RevPAR',
    full: 'Revenue per Available Room',
    ru: 'Доход на один доступный номер',
    desc: 'Учитывает и цену, и загрузку одновременно — более полная картина, чем просто ADR.',
    formula: 'RevPAR = ADR × Occupancy  или  RevPAR = Выручка / Доступные номеро-ночи',
    usage: 'Одна из базовых рыночных метрик. Показывает, насколько эффективно объект генерирует доход с учётом незаполненных ночей. Не рассматриваем её как единственный источник истины.',
  },
  {
    abbr: 'Occupancy',
    full: 'Occupancy Rate',
    ru: 'Загрузка объекта',
    desc: 'Какой процент ночей объект был занят за период.',
    formula: 'Occupancy = Проданные ночи / Доступные ночи × 100%',
    usage: 'Ключевой индикатор востребованности локации. Анализируем в динамике и в сравнении с типичной загрузкой аналогичных объектов в зоне.',
  },
  {
    abbr: 'LOS',
    full: 'Length of Stay',
    ru: 'Средняя длина пребывания',
    desc: 'Сколько ночей в среднем остаются гости в объектах вашей зоны.',
    formula: 'LOS = Общее количество ночей / Количество бронирований',
    usage: 'Влияет на операционную нагрузку и оптимальную ценовую стратегию. Короткие LOS — высокая оборачиваемость, длинные — стабильность без частых смен.',
  },
  {
    abbr: 'GOPPAR',
    full: 'Gross Operating Profit per Available Room',
    ru: 'Валовая операционная прибыль на доступный номер',
    desc: 'Показывает не просто выручку, а то, сколько объект реально приносит с учётом операционных расходов.',
    formula: 'GOPPAR = Валовая операционная прибыль / Количество доступных номеров',
    usage: 'Рассматриваем как ориентир реальной прибыльности, а не только объёма бронирований. Помогает не переоценивать локации с высокой выручкой, но слабой экономикой.',
  },
  {
    abbr: 'TRevPAR',
    full: 'Total Revenue per Available Room',
    ru: 'Совокупный доход на доступный номер',
    desc: 'Расширенная версия RevPAR — учитывает все источники дохода, а не только размещение.',
    formula: 'TRevPAR = Совокупная выручка / Количество доступных номеров',
    usage: 'Используем для оценки полного потенциала объекта с дополнительными услугами — поздний выезд, питание, трансфер.',
  },
  {
    abbr: 'NRevPAR',
    full: 'Net Revenue per Available Room',
    ru: 'Чистый доход на доступный номер',
    desc: 'RevPAR после вычета комиссий площадок и прямых затрат на дистрибуцию.',
    formula: 'NRevPAR = (Выручка − Комиссии − Затраты на дистрибуцию) / Доступные номеро-ночи',
    usage: 'Важен для сравнения объектов с разной структурой каналов продаж. Показывает реальную отдачу, а не валовую выручку.',
  },
  {
    abbr: 'Booking Window',
    full: 'Booking Window',
    ru: 'Период опережения бронирования',
    desc: 'За сколько дней до заезда гости обычно бронируют объекты в вашей зоне.',
    formula: 'Медиана или среднее: дата бронирования → дата заезда',
    usage: 'Помогает понять характер спроса в локации: туристический (бронируют заранее) или деловой (бронируют за 1–3 дня). Влияет на ценовую стратегию и управление доступностью.',
  },
  {
    abbr: 'MPI',
    full: 'Market Penetration Index',
    ru: 'Индекс проникновения на рынок',
    desc: 'Показывает, насколько доля объекта в загрузке соответствует его доле в предложении зоны.',
    formula: 'MPI = Occupancy объекта / Occupancy конкурентного сета × 100',
    usage: 'MPI > 100 означает, что объект занимает непропорционально большую долю рынка. Используем как один из индикаторов конкурентной позиции в локации.',
  },
];

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function KakMyOcenivaemPage() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" />

      <main>

        {/* ── Hero / Intro ── */}
        <section className="py-20 sm:py-28 px-4 sm:px-6 bg-[var(--t-bg)]">
          <div className="max-w-3xl mx-auto">
            <Link
              href={PRODUCT_HREF}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--t-muted)] hover:text-[var(--t-text)] transition-colors mb-6"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Отчёт по доходности объектов
            </Link>
            <h1 className="text-4xl sm:text-5xl font-bold text-[var(--t-text)] leading-tight tracking-tight">
              Как мы оцениваем доходность объектов
            </h1>
            <p className="mt-5 text-lg text-[var(--t-text-2)] leading-relaxed">
              Мы используем открытые данные, отраслевые метрики и собственную модель оценки,
              чтобы показать вероятный потенциал, ограничения и вопросы, которые нужно проверить по конкретному объекту.
            </p>
          </div>
        </section>

        {/* ── Data we consider ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Какие данные мы учитываем
            </h2>
            <p className="text-[var(--t-muted)] text-base mb-10">
              Каждый фактор влияет на итоговую доходность — мы разбираем их в связке, а не по отдельности.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {DATA_FACTORS.map((f) => (
                <div
                  key={f.label}
                  className="p-5 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-bg)] transition-all"
                >
                  <span className="text-xl" aria-hidden>{f.icon}</span>
                  <h3 className="mt-3 font-semibold text-[var(--t-text)] text-sm">{f.label}</h3>
                  <p className="mt-1 text-xs text-[var(--t-muted)] leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Industry metrics ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Отраслевые метрики
            </h2>
            <p className="text-[var(--t-muted)] text-base mb-10">
              Стандартные гостиничные показатели — основа любого серьёзного анализа.
              Ниже — что каждый из них означает и как мы его применяем.
            </p>
            <div className="space-y-4">
              {METRICS.map((m) => (
                <div
                  key={m.abbr}
                  className="p-6 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-all"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
                    <span className="text-lg font-bold text-[var(--t-text)]">{m.abbr}</span>
                    <span className="text-sm text-[var(--t-muted)]">{m.full}</span>
                    <span className="text-sm font-medium text-[var(--t-text-2)]">— {m.ru}</span>
                  </div>
                  <p className="text-sm text-[var(--t-text-2)] leading-relaxed mb-4">{m.desc}</p>
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--t-muted)] mb-1">Формула</p>
                      <code className="text-xs text-[var(--t-text)] bg-[var(--t-bg)] border border-[var(--t-border)] rounded-lg px-3 py-2 block leading-relaxed font-mono">
                        {m.formula}
                      </code>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--t-muted)] mb-1">Как мы используем</p>
                      <p className="text-sm text-[var(--t-text-2)] leading-relaxed">{m.usage}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why metrics alone aren't enough ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-4">
              Почему одних гостиничных метрик недостаточно
            </h2>
            <p className="text-[var(--t-text-2)] text-base leading-relaxed mb-6">
              Классические метрики полезны и обязательны — без них анализ не имеет основания.
              Но они не объясняют полностью, почему один объект зарабатывает больше другого
              в той же зоне.
            </p>
            <p className="text-[var(--t-text-2)] text-base leading-relaxed mb-8">
              ADR и RevPAR показывают результат — но не причину. Два объекта с одинаковым RevPAR
              могут иметь принципиально разные перспективы: один стоит рядом с устойчивым
              источником спроса, другой зависит от случайного трафика.
            </p>
            <div className="space-y-3 mb-8">
              <p className="text-sm font-semibold text-[var(--t-text)] mb-3">
                Поэтому мы дополнительно анализируем:
              </p>
              {[
                'Структуру спроса — устойчивый он или тактический',
                'Тип аудитории и как это влияет на срок и цену',
                'Близость к постоянным драйверам: деловые центры, вузы, медицина',
                'Давление конкуренции и ценовой диапазон зоны',
                'Различие между первичным и вторичным спросом в локации',
              ].map((item) => (
                <div key={item} className="flex gap-3 items-start">
                  <span className="text-[var(--t-accent)] mt-0.5 shrink-0" aria-hidden>→</span>
                  <p className="text-sm text-[var(--t-text-2)] leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
            <div className="p-5 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)]">
              <p className="text-sm text-[var(--t-text-2)] leading-relaxed italic">
                Мы опираемся на общепринятые рыночные показатели, но дополняем их более глубокой
                оценкой локации, структуры спроса и конкурентного давления. Это помогает отделять
                адресные сигналы от общих средних значений и честно показывать ограничения данных.
              </p>
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)]">
              Заказать отчёт по доходности объектов
            </h2>
            <p className="mt-4 text-[var(--t-text-2)] text-lg leading-relaxed">
              Отправьте адрес — подготовим оценку потенциала с явными допущениями и ограничениями.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={REPORT_CTA_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2.5 px-8 py-4 bg-[var(--t-accent)] text-white font-bold rounded-xl hover:bg-[var(--t-accent-hover)] transition-all shadow-lg hover:scale-[1.02] text-base w-full sm:w-auto"
              >
                <TgIcon className="w-5 h-5 shrink-0" />
                Получить расчёт по адресу
              </a>
              <Link
                href={PRODUCT_HREF}
                className="inline-flex items-center justify-center px-8 py-4 bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text-2)] font-semibold rounded-xl hover:bg-[var(--t-bg)] transition-all text-base w-full sm:w-auto"
              >
                Подробнее об отчёте
              </Link>
            </div>
            <p className="mt-4 text-xs text-[var(--t-muted)]">
              Итог зависит от качества данных, объекта, сезона, каналов и управления.
            </p>
          </div>
        </section>

      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <div className="py-6 px-4 sm:px-6 border-t border-[var(--t-border)] bg-[var(--t-bg)]">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-[var(--t-text)] font-bold text-lg hover:opacity-80 transition-opacity">
                ASI
              </Link>
              <span className="text-xs text-[var(--t-muted)]">© {new Date().getFullYear()}</span>
            </div>
          </div>
        </div>
        <RuComplianceFooter tone="theme" />
      </footer>
    </ThemeProvider>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { TgIcon } from '@/components/TgIcon';

export const metadata: Metadata = {
  title: 'Отчёт по доходности объектов — ASI',
  description:
    'Показываем ожидаемый доход, уровень спроса, конкуренцию и ключевые факторы по конкретному адресу. Для квартир, апартаментов, мини-отелей и апарт-отелей.',
};

const METHODOLOGY_HREF = '/kak-my-ocenivaem-dohodnost-obektov';
const REPORT_CTA_HREF  = 'https://t.me/ASI_core_bot';

/* ─── Report features ─────────────────────────────────────────────────────── */
const REPORT_FEATURES = [
  {
    icon: '📈',
    title: 'Потенциал дохода',
    desc: 'Ожидаемая выручка по адресу с учётом сезонности, спроса и ценового уровня зоны.',
  },
  {
    icon: '📍',
    title: 'Спрос по локации',
    desc: 'Как часто бронируют объекты в вашей зоне, в какие периоды — и кто ваша аудитория.',
  },
  {
    icon: '🏘️',
    title: 'Конкурентное окружение',
    desc: 'Сколько объектов рядом, их уровень, ценовой диапазон и загрузка.',
  },
  {
    icon: '⚡',
    title: 'Факторы, влияющие на загрузку',
    desc: 'Транспорт, точки притяжения, инфраструктура — что из этого работает на вашу доходность.',
  },
  {
    icon: '🎯',
    title: 'Сильные и слабые стороны',
    desc: 'Что объективно помогает объекту зарабатывать — и где есть точка роста.',
  },
];

/* ─── For whom ────────────────────────────────────────────────────────────── */
const FOR_WHOM = [
  { icon: '🏠', label: 'Квартиры' },
  { icon: '🏢', label: 'Апартаменты' },
  { icon: '🏨', label: 'Мини-отели' },
  { icon: '🏬', label: 'Апарт-отели' },
  { icon: '📦', label: 'Несколько объектов' },
];

/* ─── Map visual ──────────────────────────────────────────────────────────── */
function ReportMapVisual() {
  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-[var(--t-border)] bg-[var(--t-surface)]">

      {/* Badge */}
      <div className="absolute top-3 left-3 z-10">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--t-bg)]/90 border border-[var(--t-border)] backdrop-blur-sm text-[10px] font-bold uppercase tracking-widest text-[var(--t-muted)]">
          Пример отчёта
        </span>
      </div>

      {/* Stat chips top-right */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        {[
          { label: 'Потенциал выручки', value: '128 000 ₽/мес' },
          { label: 'ADR зоны', value: '4 200 ₽' },
          { label: 'Загрузка зоны', value: '72%' },
        ].map(({ label, value }) => (
          <span
            key={label}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--t-bg)]/90 border border-[var(--t-border)] backdrop-blur-sm text-[11px] font-medium text-[var(--t-text-2)] whitespace-nowrap"
          >
            {label}:{' '}
            <span className="text-[var(--t-text)] font-semibold">{value}</span>
          </span>
        ))}
      </div>

      {/* SVG map */}
      <svg
        viewBox="0 0 800 400"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full block"
        aria-hidden
        role="img"
        aria-label="Пример аналитической карты объекта"
      >
        {/* Map background */}
        <rect width="800" height="400" fill="var(--t-surface)" />

        {/* Street grid */}
        {[70, 140, 200, 270, 330, 390].map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="800" y2={y} stroke="var(--t-border)" strokeWidth="1" opacity="0.6" />
        ))}
        {[80, 160, 240, 320, 400, 480, 560, 640, 720].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="400" stroke="var(--t-border)" strokeWidth="1" opacity="0.6" />
        ))}
        {/* Wider roads */}
        <line x1="0" y1="200" x2="800" y2="200" stroke="var(--t-border)" strokeWidth="2.5" opacity="0.5" />
        <line x1="400" y1="0" x2="400" y2="400" stroke="var(--t-border)" strokeWidth="2.5" opacity="0.5" />

        {/* Zone fill 1 km */}
        <circle cx="400" cy="200" r="190" fill="var(--t-accent)" opacity="0.04" />
        {/* Zone fill 500 m */}
        <circle cx="400" cy="200" r="100" fill="var(--t-accent)" opacity="0.07" />

        {/* Radius circle 1 km */}
        <circle cx="400" cy="200" r="190" fill="none" stroke="var(--t-accent)" strokeWidth="1" strokeDasharray="5 6" opacity="0.35" />
        {/* Radius circle 500 m */}
        <circle cx="400" cy="200" r="100" fill="none" stroke="var(--t-accent)" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.55" />

        {/* Radius labels */}
        <text x="400" y="97" textAnchor="middle" fontSize="10" fill="var(--t-accent)" opacity="0.75" fontFamily="system-ui">500 м</text>
        <text x="400" y="7" textAnchor="middle" fontSize="9" fill="var(--t-accent)" opacity="0.45" fontFamily="system-ui">1 000 м</text>

        {/* Metro markers */}
        <rect x="248" y="164" width="30" height="18" rx="4" fill="#2CA5E0" opacity="0.85" />
        <text x="263" y="177" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold" fontFamily="system-ui">М</text>
        <rect x="530" y="218" width="30" height="18" rx="4" fill="#2CA5E0" opacity="0.85" />
        <text x="545" y="231" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold" fontFamily="system-ui">М</text>

        {/* Competitor markers (amber dots) */}
        {[[320, 175], [460, 240], [350, 250], [455, 175], [340, 220]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="5.5" fill="#f59e0b" opacity="0.85" />
        ))}

        {/* Attraction markers (green dots) */}
        {[[490, 160], [310, 270], [470, 290]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="5" fill="#10b981" opacity="0.85" />
        ))}

        {/* Object marker */}
        <circle cx="400" cy="200" r="14" fill="var(--t-accent)" opacity="0.18" />
        <circle cx="400" cy="200" r="7" fill="var(--t-accent)" />
        <circle cx="400" cy="200" r="3" fill="white" opacity="0.9" />
      </svg>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-[var(--t-border)] flex flex-wrap gap-3">
        {[
          { color: 'bg-[var(--t-accent)]', label: 'Ваш объект' },
          { color: 'bg-amber-400', label: 'Конкуренты' },
          { color: 'bg-emerald-400', label: 'Точки притяжения' },
          { color: 'bg-sky-400', label: 'Метро / транспорт' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-[var(--t-text-2)]">
            <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />
            {label}
          </span>
        ))}
        <span className="ml-auto text-xs text-[var(--t-muted)] italic">Данные условные — для наглядности</span>
      </div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function OtchetPoDohodnostiPage() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" />

      <main>

        {/* ── Hero ── */}
        <section className="py-20 sm:py-28 px-4 sm:px-6 bg-[var(--t-bg)]">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-[var(--t-text)] leading-tight tracking-tight">
              Сколько реально могут приносить ваши объекты
            </h1>
            <p className="mt-5 text-lg sm:text-xl text-[var(--t-text-2)] leading-relaxed max-w-2xl mx-auto">
              Показываем ожидаемый доход, уровень спроса, конкуренцию и ключевые факторы по конкретному адресу.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={REPORT_CTA_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-8 py-4 bg-[var(--t-accent)] text-white font-bold rounded-xl hover:bg-[var(--t-accent-hover)] transition-all shadow-lg hover:scale-[1.02] text-base w-full sm:w-auto"
              >
                Получить отчёт
              </a>
              <Link
                href={METHODOLOGY_HREF}
                className="inline-flex items-center justify-center px-8 py-4 bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text-2)] font-semibold rounded-xl hover:bg-[var(--t-surface-2)] transition-all text-base w-full sm:w-auto"
              >
                Как мы оцениваем доходность
              </Link>
            </div>
          </div>
        </section>

        {/* ── Visual report example ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)]">
                Что вы получаете в отчёте
              </h2>
              <p className="mt-2 text-[var(--t-muted)] text-base">
                Аналитика по локации, спросу и конкурентной среде — по конкретному адресу.
              </p>
            </div>
            <ReportMapVisual />
          </div>
        </section>

        {/* ── What the report shows ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Что показывает отчёт
            </h2>
            <p className="text-[var(--t-muted)] text-base mb-10">
              Пять ключевых блоков — понятно и без лишнего.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {REPORT_FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="p-5 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-all"
                >
                  <span className="text-2xl" aria-hidden>{f.icon}</span>
                  <h3 className="mt-3 font-semibold text-[var(--t-text)] text-sm leading-snug">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-[var(--t-muted)] leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── For whom ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Для каких объектов
            </h2>
            <p className="text-[var(--t-muted)] text-base mb-8">
              Отчёт работает для любых объектов посуточной аренды — от одной квартиры до портфеля.
            </p>
            <div className="flex flex-wrap gap-3">
              {FOR_WHOM.map(({ icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] text-sm font-medium text-[var(--t-text-2)]"
                >
                  <span aria-hidden>{icon}</span>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Trust / methodology teaser ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-3xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--t-muted)] mb-4">
              Методология
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-4">
              Мы не берём цифры «с потолка»
            </h2>
            <p className="text-[var(--t-text-2)] text-base leading-relaxed mb-6">
              Расчёт основан на открытых данных, отраслевых метриках и собственной модели анализа
              локации, спроса и конкурентной среды. Мы используем стандартные гостиничные показатели
              и дополняем их более глубокой оценкой конкретного адреса — так результат точнее,
              чем усреднённые рыночные данные.
            </p>
            <Link
              href={METHODOLOGY_HREF}
              className="inline-flex items-center gap-2 text-[var(--t-text)] font-semibold text-base hover:gap-3 transition-all"
            >
              Как мы оцениваем доходность объектов
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[var(--t-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)]">
              Проверьте доходность ваших объектов
            </h2>
            <p className="mt-4 text-[var(--t-text-2)] text-lg leading-relaxed">
              Отправьте адрес — подготовим отчёт по локации, спросу и конкурентной среде.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={REPORT_CTA_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2.5 px-8 py-4 bg-[var(--t-accent)] text-white font-bold rounded-xl hover:bg-[var(--t-accent-hover)] transition-all shadow-lg hover:scale-[1.02] text-base w-full sm:w-auto"
              >
                <TgIcon className="w-5 h-5 shrink-0" />
                Получить отчёт
              </a>
              <Link
                href={METHODOLOGY_HREF}
                className="inline-flex items-center justify-center px-8 py-4 bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text-2)] font-semibold rounded-xl hover:bg-[var(--t-bg)] transition-all text-base w-full sm:w-auto"
              >
                Как мы считаем
              </Link>
            </div>
            <p className="mt-4 text-xs text-[var(--t-muted)]">
              Без обязательств. Ответ — в течение одного рабочего дня.
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

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
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import {
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const PILOT_HREF = '/ru/early-access';
const HOME_HREF = '/ru';

const NOW_ITEMS = [
  {
    title: 'AI-ответы гостям',
    desc: 'Типовые вопросы по заселению, Wi-Fi, правилам объекта и быту — в цифровых каналах.',
  },
  {
    title: 'Человек на исключениях',
    desc: 'Нестандартные ситуации уходят владельцу или оператору с контекстом переписки.',
  },
  {
    title: 'Пилот на один объект',
    desc: `${COMMUNICATION_PILOT_SERVICE_TITLE}: 1 объект, 1 месяц, ${COMMUNICATION_PILOT_PRICE_RUB} ₽.`,
  },
  {
    title: 'Оценка локации (отдельно)',
    desc: 'Проверка адреса по спросу и окружению — вспомогательный инструмент, не замена пилоту коммуникаций.',
    separate: true,
  },
] as const;

const ROADMAP_ITEMS = [
  {
    title: 'Управление объявлениями и каналами',
    desc: 'Направление платформы: синхронизация и обновления по площадкам. Не входит в текущий пилот как готовая услуга.',
  },
  {
    title: 'Динамическое ценообразование',
    desc: 'Направление платформы: автоматическая подстройка тарифов. Сейчас в пилоте не продаётся как отдельный модуль.',
  },
  {
    title: 'Уборки, доступы, расписание',
    desc: 'Направление платформы: координация операционных задач. Не обещаем как текущую возможность пилота.',
  },
  {
    title: 'Отзывы и репутация',
    desc: 'Направление платформы. В пилоте фокус на гостевой переписке.',
  },
  {
    title: 'Финансовая отчётность',
    desc: 'Направление платформы: сводки и прогнозы. Не часть тарифа 1 объект / 1 месяц.',
  },
  {
    title: 'Мониторинг безопасности',
    desc: 'Направление платформы. Не заявляем как live-функцию закрытого пилота.',
  },
] as const;

const FLOW_STEPS = [
  {
    n: '01',
    title: 'Сообщение гостя',
    body: 'Вопрос о Wi-Fi, заезде, парковке, правилах или выезде.',
  },
  {
    n: '02',
    title: 'ASI получает контекст',
    body: 'Ответ строится по данным конкретного объекта.',
  },
  {
    n: '03',
    title: 'Рутина закрывается',
    body: 'Типовой сценарий обрабатывается без постоянного участия владельца.',
  },
  {
    n: '04',
    title: 'Исключение?',
    body: 'Если запрос выходит за рамки типового — нужен человек.',
  },
  {
    n: '05',
    title: 'Человек получает кейс',
    body: 'Оператор видит контекст и принимает решение.',
  },
] as const;

export default function RuHowItWorksPage() {
  const nowCore = NOW_ITEMS.filter((item) => !('separate' in item && item.separate));
  const locationItem = NOW_ITEMS.find((item) => 'separate' in item && item.separate);

  return (
    <div className="font-sans bg-asi-ivory text-asi-navy antialiased">
      <RuPublicNavHeader density="landing" />

      <main>
        {/* ── 1. Hero ── */}
        <section className="relative bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 overflow-hidden">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.15fr,0.85fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="flex items-center gap-3">
                <BrandLogoMark size={34} />
                <span className="font-serif text-2xl text-asi-navy">ASI</span>
              </div>
              <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                Как работает ASI
              </p>
              <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.5rem]">
                Рутина движется автоматически.
                <br />
                <span className="text-asi-gold">Человек подключается к исключениям.</span>
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-xl leading-relaxed">
                Закрытый RU-пилот начинается с гостевых коммуникаций для одного объекта посуточной
                аренды. Здесь — как устроена модель сегодня и куда идёт платформа.
              </p>
              <p className="mt-4 text-sm font-sans text-asi-navy/60 tracking-wide">
                {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ · 1 объект · 1 месяц
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <BrandPrimaryCta href={PILOT_HREF}>Подключить пилот</BrandPrimaryCta>
                <BrandSecondaryCta href="#current-pilot">Сейчас в пилоте</BrandSecondaryCta>
              </div>
            </div>

            <div className="border border-asi-border bg-asi-paper p-6 sm:p-8">
              <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Принцип
              </p>
              <p className="mt-4 font-serif text-2xl sm:text-3xl text-asi-navy leading-snug">
                Операции на автопилоте.
                <br />
                Человек — только для исключений.
              </p>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-sm text-asi-navy/65 leading-relaxed">
                Это направление платформы. Текущий коммерческий шаг — AI-ответы гостям на одном
                объекте, а не полная автоматизация бизнеса уже сейчас.
              </p>
            </div>
          </div>
        </section>

        {/* ── 2. Operating model ── */}
        <BrandSection variant="navy">
          <BrandEyebrow dark>Модель работы</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            От сообщения гостя до ответа
            <br />
            или эскалации человеку
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-ivory/65 leading-relaxed">
            Типовые сценарии закрывает ASI по данным объекта. Нестандартные ситуации остаются за
            человеком — с контекстом переписки.
          </p>
          <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-5 gap-px bg-asi-ivory/15 border border-asi-ivory/15">
            {FLOW_STEPS.map((step) => (
              <li key={step.n} className="bg-asi-navy p-5 sm:p-6">
                <span className="font-serif text-asi-gold-soft text-2xl">{step.n}</span>
                <h3 className="mt-4 font-serif text-lg text-asi-ivory leading-snug">{step.title}</h3>
                <p className="mt-3 text-sm text-asi-ivory/65 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </BrandSection>

        {/* ── 3. Current pilot ── */}
        <BrandSection variant="paper" id="current-pilot">
          <BrandEyebrow>Сейчас / пилот</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Что доступно в закрытом пилоте
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Фокус — рутинная переписка с гостями. Это не «полная автоматизация объекта на 99%».
          </p>
          <div className="mt-12 grid sm:grid-cols-3 gap-px bg-asi-border border border-asi-border">
            {nowCore.map((item) => (
              <div key={item.title} className="bg-asi-ivory p-7 sm:p-8">
                <h3 className="font-serif text-xl text-asi-navy">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          {locationItem ? (
            <div className="mt-8 border border-asi-border bg-asi-paper p-7 sm:p-8 max-w-2xl">
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Отдельный инструмент
              </p>
              <h3 className="mt-3 font-serif text-xl text-asi-navy">{locationItem.title}</h3>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">{locationItem.desc}</p>
              <p className="mt-4 text-sm text-asi-navy/55">
                Не входит в тариф пилота AI-коммуникаций за {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽.
              </p>
            </div>
          ) : null}
        </BrandSection>

        {/* ── 4. Real-world examples ── */}
        <BrandSection variant="ivory">
          <BrandEyebrow>Пример</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-3xl">
            Как это выглядит в реальном обращении
          </BrandHeadline>
          <div className="mt-12 grid lg:grid-cols-2 gap-8 lg:gap-12">
            <article className="border border-asi-border bg-asi-paper p-7 sm:p-8">
              <p className="font-serif text-asi-gold text-2xl">23:07</p>
              <p className="mt-2 text-xs font-sans font-semibold uppercase tracking-[0.16em] text-asi-gold-text">
                Типовой сценарий
              </p>
              <div className="mt-6 space-y-5">
                <div>
                  <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-navy/45">
                    Гость
                  </p>
                  <p className="mt-2 font-serif text-xl text-asi-navy leading-snug">
                    «Не могу найти пароль от Wi-Fi»
                  </p>
                </div>
                <div className="h-px w-10 bg-asi-gold" aria-hidden />
                <div>
                  <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-navy/45">
                    ASI
                  </p>
                  <p className="mt-2 text-sm text-asi-navy/70 leading-relaxed">
                    Отвечает по данным объекта: сеть, пароль, подсказки по подключению — без
                    ожидания владельца ночью.
                  </p>
                </div>
              </div>
            </article>

            <article className="border border-asi-border bg-asi-navy p-7 sm:p-8 text-asi-ivory">
              <p className="font-serif text-asi-gold-soft text-2xl">Исключение</p>
              <p className="mt-2 text-xs font-sans font-semibold uppercase tracking-[0.16em] text-asi-gold-soft">
                Нужна оценка человека
              </p>
              <div className="mt-6 space-y-5">
                <div>
                  <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-ivory/45">
                    Гость
                  </p>
                  <p className="mt-2 font-serif text-xl text-asi-ivory leading-snug">
                    Сообщает о нетиповой ситуации, где нужен разбор и решение.
                  </p>
                </div>
                <div className="h-px w-10 bg-asi-gold-soft" aria-hidden />
                <div>
                  <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-ivory/45">
                    Человек подключается
                  </p>
                  <p className="mt-2 text-sm text-asi-ivory/70 leading-relaxed">
                    Владелец или оператор получает кейс с контекстом переписки. Решение остаётся за
                    человеком.
                  </p>
                </div>
              </div>
            </article>
          </div>
        </BrandSection>

        {/* ── 5. Current vs future ── */}
        <BrandSection variant="paper">
          <BrandEyebrow>Сейчас и дальше</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Сначала коммуникации.
            <br />
            Затем операционный слой.
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Ниже — явное разделение: что входит в текущий пилот, а что остаётся направлением
            платформы без сроков и без обещания «уже сейчас».
          </p>

          <div className="mt-12 grid lg:grid-cols-2 gap-10 lg:gap-16">
            <div>
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Сейчас
              </p>
              <h3 className="mt-3 font-serif text-2xl text-asi-navy">Гостевые коммуникации</h3>
              <ul className="mt-6 divide-y divide-asi-border border-y border-asi-border">
                <li className="py-4 text-sm text-asi-navy/75">AI-ответы на типовые вопросы гостей</li>
                <li className="py-4 text-sm text-asi-navy/75">Эскалация исключений человеку</li>
                <li className="py-4 text-sm text-asi-navy/75">Знание конкретного объекта</li>
                <li className="py-4 text-sm text-asi-navy/75">
                  Пилот: 1 объект · 1 месяц · {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽
                </li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Дальше
              </p>
              <h3 className="mt-3 font-serif text-2xl text-asi-navy">Операционная платформа ASI</h3>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
                Те же принципы — рутина системе, человек на исключениях — для более широкого
                контура объекта. Это направление, а не состав текущего тарифа.
              </p>
            </div>
          </div>
        </BrandSection>

        {/* ── 6. Roadmap ── */}
        <BrandSection variant="navy" id="roadmap">
          <BrandEyebrow dark>Дорожная карта платформы</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            Куда развивается ASI
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-ivory/65 leading-relaxed">
            Направление продукта. Эти пункты не продаются как готовые модули текущего пилота и не
            имеют сроков в публичном обещании.
          </p>
          <ul className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-asi-ivory/15 border border-asi-ivory/15">
            {ROADMAP_ITEMS.map((item) => (
              <li key={item.title} className="bg-asi-navy p-6 sm:p-7">
                <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-gold-soft">
                  Направление платформы
                </p>
                <h3 className="mt-3 font-serif text-lg text-asi-ivory">{item.title}</h3>
                <p className="mt-3 text-sm text-asi-ivory/65 leading-relaxed">{item.desc}</p>
              </li>
            ))}
          </ul>
        </BrandSection>

        {/* ── 7. Bigger idea ── */}
        <BrandSection variant="ivory">
          <BrandEyebrow>Направление</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-4xl max-w-3xl">
            Операционный слой для физического бизнеса
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-6" />
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 max-w-5xl">
            <div>
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Сегодня
              </p>
              <p className="mt-3 font-serif text-xl text-asi-navy leading-snug">
                Гостевые коммуникации — первый операционный слой.
              </p>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
                Закрытый пилот проверяет модель на одном объекте: типовые вопросы системе, решения —
                человеку.
              </p>
            </div>
            <div>
              <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Платформа
              </p>
              <p className="mt-3 font-serif text-xl text-asi-navy leading-snug">
                Больше рутинных доменов — в ту же модель исключений.
              </p>
              <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
                Каналы, цены, уборки, доступы и отчётность — направление. Не обещание текущего RU
                тарифа.
              </p>
            </div>
          </div>
        </BrandSection>

        {/* ── 8. Closing conversion ── */}
        <BrandSection variant="paper">
          <div className="grid lg:grid-cols-[1.2fr,0.8fr] gap-10 lg:gap-16 items-center">
            <div>
              <BrandEyebrow>Следующий шаг</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
                Начните с одного объекта.
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-asi-navy/70 leading-relaxed max-w-xl">
                Закрытый пилот стартует с одного объекта и гостевых коммуникаций. Условия и заявка —
                на странице пилота.
              </p>
              <p className="mt-4 text-sm font-sans text-asi-navy/60 tracking-wide">
                {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ · 1 объект · 1 месяц
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <BrandPrimaryCta href={PILOT_HREF}>Подключить пилот</BrandPrimaryCta>
                <BrandSecondaryCta href={HOME_HREF}>На главную</BrandSecondaryCta>
              </div>
            </div>
            <div className="border border-asi-border bg-asi-ivory p-8 flex flex-col justify-between min-h-[14rem]">
              <div>
                <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                  Пилот коммуникаций
                </p>
                <p className="mt-4 font-serif text-2xl text-asi-navy leading-snug">
                  {COMMUNICATION_PILOT_SERVICE_TITLE}
                </p>
              </div>
              <div className="mt-8 flex items-end justify-between gap-4">
                <p className="text-sm text-asi-navy/60">
                  {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ · 1 объект · 1 месяц
                </p>
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

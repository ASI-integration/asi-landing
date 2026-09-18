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
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { COMMUNICATION_PILOT_PRICE_RUB } from '@/lib/payments/yookassa-env';

export const metadata: Metadata = {
  title: 'Как работает ASI',
  description:
    'ASI берёт на себя повторяющиеся вопросы гостей по данным объекта. Бесплатное подключение, 14 дней пилота после готовности, 1 000 ₽ за объект в месяц только если решите продолжить.',
};

const PILOT_HREF = '/ru/early-access';
const HOME_HREF = '/ru';
const PRIMARY_CTA_LABEL = 'Подключить объект бесплатно';

const EXAMPLE_QUESTIONS = [
  '«Как подключиться к Wi-Fi?»',
  '«Где парковаться?»',
  '«Как попасть в квартиру?»',
  '«Можно заехать раньше?»',
  '«Можно выехать позже?»',
  '«Какие правила действуют в квартире?»',
] as const;

const PILOT_WATCH_ITEMS = [
  'какие типовые вопросы система может обрабатывать по данным объекта;',
  'где информации не хватает;',
  'в каких ситуациях требуется человек.',
] as const;

const PRICE_ROWS = [
  {
    title: 'Подключение и настройка — 0 ₽',
    body: 'Этот этап не входит в 14 дней пилота.',
  },
  {
    title: '14 дней работы на объекте — 0 ₽',
    body: 'Отсчёт начинается только после полной готовности.',
  },
  {
    title: `После пилота — ${COMMUNICATION_PILOT_PRICE_RUB} ₽ за объект в месяц`,
    body: 'Только если вы увидели пользу и решили продолжить.',
  },
] as const;

/** De-emphasized below the conversion story; not part of the main sales narrative. */
const ROADMAP_ITEMS = [
  {
    title: 'Управление объявлениями и каналами',
    desc: 'Направление продукта. Не входит в текущий пилот как готовая услуга.',
  },
  {
    title: 'Подсказки по ценам',
    desc: 'Направление продукта. Сейчас в пилоте не продаётся как отдельный модуль.',
  },
  {
    title: 'Уборки, доступы, расписание',
    desc: 'Направление продукта. Не обещаем как текущую возможность пилота.',
  },
  {
    title: 'Отзывы и репутация',
    desc: 'Направление продукта. В пилоте фокус на общении с гостями.',
  },
  {
    title: 'Финансовая отчётность',
    desc: 'Направление продукта. Не часть текущего пилота.',
  },
  {
    title: 'Мониторинг безопасности',
    desc: 'Направление продукта. Не заявляем как live-функцию текущего пилота.',
  },
] as const;

export default function RuHowItWorksPage() {
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
              <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.25rem]">
                Управлять посуточными квартирами — не значит весь день сидеть в чатах
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-lg text-asi-navy/70 max-w-xl leading-relaxed">
                ASI автоматизирует типовую рутину вокруг каждого объекта: берёт на себя однотипные
                вопросы гостей, опирается на данные конкретного объекта и заданные сценарии и
                оставляет человеку ситуации, где действительно нужно решение.
              </p>
              <p className="mt-4 text-sm font-sans text-asi-navy/60 tracking-wide leading-relaxed max-w-xl">
                Бесплатное подключение и настройка · 14 дней пилота отсчитываются только после полной
                готовности · {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ / объект в месяц, если решите
                продолжить
              </p>
              <div className="mt-9 flex flex-wrap gap-4">
                <BrandPrimaryCta href={PILOT_HREF}>{PRIMARY_CTA_LABEL}</BrandPrimaryCta>
                <BrandSecondaryCta href="#market-problem">Почему это важно</BrandSecondaryCta>
              </div>
            </div>

            <div className="border border-asi-border bg-asi-paper p-6 sm:p-8">
              <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                Коротко
              </p>
              <p className="mt-4 font-serif text-2xl sm:text-3xl text-asi-navy leading-snug">
                Система занимается повторяемым.
                <br />
                Человек — решениями.
              </p>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-sm text-asi-navy/65 leading-relaxed">
                Если ответа в данных объекта нет или ситуация требует оценки — автоматический ответ
                останавливается, и вопрос передаётся человеку.
              </p>
              <div className="mt-8 flex justify-end">
                <BrandShiro size={48} />
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Market problem ── */}
        <BrandSection variant="navy" id="market-problem">
          <BrandEyebrow dark>Проблема рынка</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-4xl text-asi-ivory">
            Чем больше объектов в управлении, тем больше людей приходится нанимать
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-ivory/65 leading-relaxed">
            Сегодня рост бизнеса посуточной аренды почти всегда означает рост ручной работы.
          </p>
          <p className="mt-4 max-w-2xl text-asi-ivory/65 leading-relaxed">
            Один новый объект — это не только дополнительная выручка. Это новые бронирования,
            одинаковые вопросы гостей, заселения, выезды и постоянный поток сообщений.
          </p>
          <div className="mt-12 border border-asi-ivory/15 bg-asi-navy p-6 sm:p-8">
            <p className="font-serif text-xl sm:text-2xl text-asi-ivory leading-snug">
              Больше квартир → Больше сообщений → Больше администраторов → Больше расходов и ошибок
            </p>
          </div>
          <p className="mt-8 max-w-2xl text-asi-ivory/70 leading-relaxed">
            Мы создаём другой способ управления: новый объект должен добавлять бизнесу прибыль, а не
            ещё одного сотрудника, который весь день отвечает на однотипные сообщения.
          </p>
        </BrandSection>

        {/* ── 3. What ASI does ── */}
        <BrandSection variant="paper" id="what-asi-does">
          <BrandEyebrow>Что делает ASI</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            ASI берёт на себя повторяющиеся операции
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Система определяет, к какому объекту относится запрос, и использует подтверждённые данные
            этого объекта.
          </p>
          <ul className="mt-10 grid sm:grid-cols-2 gap-px bg-asi-border border border-asi-border">
            {EXAMPLE_QUESTIONS.map((q) => (
              <li key={q} className="bg-asi-ivory p-5 sm:p-6 font-serif text-lg text-asi-navy leading-snug">
                {q}
              </li>
            ))}
          </ul>
          <div className="mt-10 max-w-2xl space-y-4 text-asi-navy/70 leading-relaxed">
            <p>Если ответ есть в подтверждённых данных объекта — ASI использует эти данные.</p>
            <p>
              Если информации недостаточно или ситуация требует решения человека — автоматический
              ответ останавливается, а ситуация передаётся на проверку человеку.
            </p>
          </div>
          <p className="mt-8 font-serif text-2xl sm:text-3xl text-asi-navy leading-snug max-w-xl">
            Система занимается повторяемым. Человек — решениями.
          </p>
        </BrandSection>

        {/* ── 4. Not a chatbot ── */}
        <BrandSection variant="ivory">
          <BrandEyebrow>Отличие</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            ASI — это не ещё один чат-бот
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-6" />
          <div className="max-w-2xl space-y-4 text-asi-navy/70 leading-relaxed">
            <p>Обычный чат-бот в первую очередь пытается ответить на входящее сообщение.</p>
            <p>
              ASI строится вокруг конкретного объекта: его данных, бронирования, обращения гостя и
              заданных сценариев работы.
            </p>
            <p>
              Наша задача — не просто поддержать беседу, а сократить количество ситуаций, которые
              вообще требуют ручного контроля сотрудника.
            </p>
          </div>
        </BrandSection>

        {/* ── 5. Free setup ── */}
        <BrandSection variant="paper" id="free-setup">
          <BrandEyebrow>Подключение</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            Сначала мы бесплатно настраиваем ваш объект
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-navy/70 leading-relaxed">
            Вы передаёте основные данные: адрес, правила, инструкции по заселению, Wi-Fi и другую
            информацию, необходимую для общения с гостями.
          </p>
          <p className="mt-4 max-w-2xl text-asi-navy/70 leading-relaxed">
            Мы заносим данные в систему, проверяем основные сценарии и готовность объекта к пилоту.
          </p>
          <div className="mt-10 border border-asi-border bg-asi-ivory p-6 sm:p-8 max-w-2xl">
            <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
              Важно
            </p>
            <p className="mt-3 font-serif text-xl sm:text-2xl text-asi-navy leading-snug">
              Этот этап не входит в 14 дней пилота.
            </p>
            <p className="mt-3 text-sm text-asi-navy/65 leading-relaxed">
              Отсчёт начинается только после того, как объект готов к реальной работе.
            </p>
          </div>
        </BrandSection>

        {/* ── 6. Real pilot ── */}
        <BrandSection variant="navy" id="real-pilot">
          <BrandEyebrow dark>Пилот</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl text-asi-ivory">
            Затем ASI работает на вашем реальном объекте 14 дней
          </BrandHeadline>
          <p className="mt-5 max-w-2xl text-asi-ivory/65 leading-relaxed">
            Не на демо и не на выдуманном примере — на реальном объекте и с реальными обращениями.
          </p>
          <p className="mt-6 text-asi-ivory/70">В течение пилота мы смотрим:</p>
          <ul className="mt-4 max-w-2xl space-y-3 text-asi-ivory/65 leading-relaxed">
            {PILOT_WATCH_ITEMS.map((item) => (
              <li key={item} className="border-t border-asi-ivory/15 pt-3">
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-2xl text-asi-ivory/70 leading-relaxed">
            Нестандартные ситуации остаются под контролем владельца или оператора.
          </p>
        </BrandSection>

        {/* ── 7. Result ── */}
        <BrandSection variant="ivory" id="pilot-result">
          <BrandEyebrow>Итог</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">
            По итогам — результат, а не обещания
          </BrandHeadline>
          <BrandGoldRule className="mt-6 mb-6" />
          <div className="max-w-2xl space-y-4 text-asi-navy/70 leading-relaxed">
            <p>После пилота вы получаете итоговый разбор работы ASI на объекте.</p>
            <p>
              Мы показываем, какие типовые сценарии проходили через систему, где требовалось участие
              человека и какие инструкции стоит добавить или уточнить, чтобы сократить ручную работу
              дальше.
            </p>
            <p>После этого вы сами решаете, продолжать или нет.</p>
          </div>
        </BrandSection>

        {/* ── 8. Price ── */}
        <BrandSection variant="paper" id="pilot-offer">
          <BrandEyebrow>Условия</BrandEyebrow>
          <BrandHeadline className="text-3xl sm:text-5xl max-w-3xl">Прозрачные условия</BrandHeadline>
          <ul className="mt-12 max-w-2xl space-y-0 border border-asi-border divide-y divide-asi-border">
            {PRICE_ROWS.map((row) => (
              <li key={row.title} className="bg-asi-ivory p-6 sm:p-7">
                <h3 className="font-serif text-xl text-asi-navy leading-snug">{row.title}</h3>
                <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{row.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-xl text-asi-navy/70 leading-relaxed">
            Только если вы увидели пользу и решили продолжить.
            <br />
            Никакого автоматического перехода на оплату после пилота.
          </p>
        </BrandSection>

        {/* ── 9. Final CTA ── */}
        <BrandSection variant="ivory">
          <div className="grid lg:grid-cols-[1.2fr,0.8fr] gap-10 lg:gap-16 items-center">
            <div>
              <BrandEyebrow>Следующий шаг</BrandEyebrow>
              <BrandHeadline className="text-3xl sm:text-5xl max-w-2xl">
                Хотите посмотреть, как это сработает на ваших объектах?
              </BrandHeadline>
              <BrandGoldRule className="mt-6 mb-6" />
              <p className="text-asi-navy/70 leading-relaxed max-w-xl">
                Мы бесплатно подготовим данные объекта и систему к работе. После полной готовности
                начнутся 14 дней пилота на реальных обращениях.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <BrandPrimaryCta href={PILOT_HREF}>{PRIMARY_CTA_LABEL}</BrandPrimaryCta>
                <BrandSecondaryCta href={HOME_HREF}>На главную</BrandSecondaryCta>
              </div>
            </div>
            <div className="border border-asi-border bg-asi-paper p-8 flex flex-col justify-between min-h-[14rem]">
              <div>
                <p className="text-xs font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                  Старт без оплаты
                </p>
                <p className="mt-4 font-serif text-2xl text-asi-navy leading-snug">
                  Подключение и 14 дней — 0&nbsp;₽
                </p>
              </div>
              <div className="mt-8 flex items-end justify-between gap-4">
                <p className="text-sm text-asi-navy/60 leading-relaxed max-w-[12rem]">
                  Затем {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽ / объект / месяц — только после
                  решения продолжить
                </p>
                <BrandShiro size={48} />
              </div>
            </div>
          </div>
        </BrandSection>

        {/* ── De-emphasized roadmap (below conversion story) ── */}
        <BrandSection variant="navy" id="roadmap">
          <BrandEyebrow dark>Дополнительно</BrandEyebrow>
          <BrandHeadline className="text-2xl sm:text-3xl max-w-3xl text-asi-ivory/90">
            Направления продукта вне текущего пилота
          </BrandHeadline>
          <p className="mt-4 max-w-2xl text-asi-ivory/50 text-sm leading-relaxed">
            Ниже — ориентиры развития. Они не входят в текущий пилот и не имеют публичных сроков.
          </p>
          <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-asi-ivory/10 border border-asi-ivory/10 opacity-90">
            {ROADMAP_ITEMS.map((item) => (
              <li key={item.title} className="bg-asi-navy p-5 sm:p-6">
                <h3 className="font-serif text-base text-asi-ivory/85">{item.title}</h3>
                <p className="mt-2 text-xs text-asi-ivory/50 leading-relaxed">{item.desc}</p>
              </li>
            ))}
          </ul>
        </BrandSection>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </div>
  );
}

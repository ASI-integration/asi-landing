'use client';

import { useState } from 'react';

const FAQ_EN = [
  {
    q: "What do you mean by '99% automation'? What's left for me to do?",
    a: "After setup, you only run two things manually: configure your property to ASI's recommendations and hire line staff (housekeepers, maintenance). Everything else — guest communication, calendar management, cleaning coordination — the system executes automatically.",
  },
  {
    q: 'Security: how are access codes and payment data stored?',
    a: "Guest payment data is never stored in ASI — it's processed encrypted on the bank's side and we receive only one-time tokens. Lock codes and Wi-Fi credentials are stored in a secure encrypted vault with encryption at rest and strict access control. The system only issues them as part of automated workflows, masking them in logs and interfaces.",
  },
  {
    q: 'Is ASI suitable for B2B: property networks, agencies, and management companies?',
    a: 'Yes. The platform is built for property portfolios: a unified dashboard, role-based access, and transparent operational visibility for each unit. Onboarding and billing can be structured under a legal entity contract — no need to maintain separate operational staff per property.',
  },
  {
    q: 'I already have a Channel Manager. Why do I need ASI?',
    a: 'A channel manager is software you still steer. ASI runs the operational layer: listings, sync, occupancy, and channel decisions execute automatically against your rules. You are not replacing one dashboard with another — you are replacing the people and manual control that sat on top of the channel stack.',
  },
  {
    q: 'How does the system handle pricing? Will it replace a revenue manager?',
    a: 'Pricing automation is on the roadmap. Today, ASI focuses on execution and location intelligence: it surfaces demand and competitive context around an address, and helps standardize operational decisions. Any pricing outputs shown in demos are estimates and not guaranteed market truth.',
  },
  {
    q: 'I only have a few apartments. Is this system too complex for me?',
    a: "On the contrary — 99% automation means the portfolio can grow without adding booking agents, administrators, or dispatchers. Eliminating even one booking role is an immediate cut in operating cost.",
  },
  {
    q: 'How does check-in work? Do I need smart locks?',
    a: 'We strongly recommend installing electronic locks — ASI then generates unique PIN codes for each guest automatically. However, the system is flexible: if you currently use mechanical keys or key boxes, we can easily configure the process around them.',
  },
  {
    q: 'How do I track cleaning and maintenance work?',
    a: "The system automatically assigns tasks to housekeepers with precise timing right after a guest checks out. We're also developing an internal database and rating system for line staff to recommend the best specialists.",
  },
  {
    q: 'Does the system protect against problematic guests?',
    a: 'Future ASI updates will include a global guest blacklist, allowing the system to screen out problematic guests at the booking stage — those who exploit platform policies by filing false complaints to get refunds.',
  },
  {
    q: 'How does ASI pay for itself so quickly?',
    a: 'Three factors: labor no longer scales with booking volume; channel and listing execution run inside ASI instead of extra subscriptions; automated pricing and channel mix remove manual vacancy risk and lift revenue per stay.',
  },
  {
    q: 'How is ASI fundamentally different from existing CRM and PMS solutions?',
    a: 'CRMs and most PMS layers are interfaces: your staff still performs the work inside them. ASI executes the work — guest comms, bookings, tasks, and coordination run automatically. Owners keep strategy and asset decisions; the operational layer runs without that headcount.',
  },
];

const FAQ_RU = [
  {
    q: 'Что вы имеете в виду под «99% автоматизации»? Что остается делать мне?',
    a: 'После запуска вручную остаются две зоны: упаковать объект по рекомендациям ASI и нанять линейный персонал (горничных, хоум-мастеров). Всё остальное — общение с гостями, календари, координация клининга — система исполняет автоматически.',
  },
  {
    q: 'Безопасность: как хранятся пароли от квартир и платежные данные?',
    a: 'Платежная информация гостей не хранится в ASI вообще: она в зашифрованном виде обрабатывается на стороне банка, а мы получаем только одноразовые токены. Коды от замков и Wi-Fi лежат в защищённом хранилище (encrypted credential vault) с шифрованием данных в покое (encryption at rest) и строгим контролем доступа. Система выдаёт их строго по сценарию, скрывая под масками в логах и интерфейсах.',
  },
  {
    q: 'Подходит ли ASI для B2B: сетей, агентств и управляющих компаний?',
    a: 'Да. Платформа рассчитана на портфели объектов: единый кабинет, роли и прозрачная операционная картина по каждой точке. Подключение и биллинг можно выстроить под договор с юрлицом — без необходимости держать отдельный операционный штат на каждый объект.',
  },
  {
    q: 'У меня уже есть менеджер каналов (Channel Manager). Зачем мне ASI?',
    a: 'Менеджер каналов — это ПО, которым вы всё равно управляете вручную. ASI исполняет операционный слой: объявления, синхронизацию, загрузку и решения по каналам автоматически по вашим правилам. Вы не меняете один дашборд на другой — вы убираете людей и ручной контроль поверх стека каналов.',
  },
  {
    q: 'Как система выстраивает ценообразование? Заменит ли она ревеню-менеджера?',
    a: 'Автоматизация ценообразования — в дорожной карте. Сейчас ASI фокусируется на исполнении и анализе локации: показывает сигналы спроса и конкурентный контекст вокруг адреса, помогает стандартизировать решения. Любые цифры по цене/доходу в демо — это оценка, а не гарантированная «рыночная правда».',
  },
  {
    q: 'У меня всего несколько квартир. Не слишком ли это сложная система?',
    a: 'Наоборот: при 99% автоматизации портфель растёт без бронистов, администраторов и диспетчеров. Отказ от одной такой роли — сразу меньше операционных расходов (в РФ один бронист часто порядка 80 000 ₽ в месяц).',
  },
  {
    q: 'Как происходит заселение? Нужно ли мне ставить умные замки?',
    a: 'Мы настоятельно рекомендуем установить электронные замки — тогда ASI будет сама генерировать уникальные пин-коды для каждого гостя. Однако система гибкая: если у вас пока механические ключи или ки-боксы, мы легко настроим процесс под них.',
  },
  {
    q: 'Как контролировать уборки и работу мастеров?',
    a: 'Система автоматически ставит задачи горничным с чётким таймингом сразу после выезда гостя. В дальнейшем мы планируем внедрить внутреннюю базу данных и систему рейтингов для линейного персонала, чтобы давать рекомендации по лучшим специалистам.',
  },
  {
    q: 'Защищает ли система от проблемных гостей?',
    a: 'В будущих обновлениях ASI появится глобальный чёрный список гостей. Это позволит на этапе бронирования отсекать проблемных постояльцев, которые злоупотребляют лояльностью площадок, жалуясь на выдуманные проблемы ради возврата денег.',
  },
  {
    q: 'За счёт чего ASI так быстро окупает свою стоимость?',
    a: 'Три фактора: фонд оплаты труда больше не растёт вместе с объёмом броней; объявления и синхронизация по каналам исполняются внутри ASI без отдельных подписок; автоматическое ценообразование и микс каналов убирают ручной риск простоев и поднимают выручку за заезд.',
  },
  {
    q: 'Чем ASI кардинально отличается от существующих CRM и PMS на рынке?',
    a: 'CRM и большинство PMS — интерфейсы: персонал всё равно выполняет работу внутри них. ASI исполняет работу — коммуникации, бронирования, задачи и координация идут автоматически. Стратегию и решения по активам оставляете себе; операционный слой крутится без этого штата.',
  },
];

export function FaqAccordion({ lang = 'en' }: { lang?: 'en' | 'ru' }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const FAQ_ITEMS = lang === 'ru' ? FAQ_RU : FAQ_EN;

  return (
    <div className="space-y-2">
      {FAQ_ITEMS.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={i}
            className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left text-[var(--t-text)] hover:bg-[var(--t-surface-2)] transition-colors duration-200 text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
            >
              <span className="font-medium leading-snug pr-2">{item.q}</span>
              <span
                className={`mt-0.5 shrink-0 text-[var(--t-muted)] text-lg leading-none transition-transform duration-300 ease-out ${
                  isOpen ? 'rotate-45' : ''
                }`}
                aria-hidden
              >
                +
              </span>
            </button>
            <div
              className={`grid overflow-hidden transition-[grid-template-rows] duration-500 ease-in-out motion-reduce:transition-none ${
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="min-h-0">
                <p className="px-5 pb-5 pt-1 text-base text-[var(--t-text-2)] leading-relaxed">
                  {item.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

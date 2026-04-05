'use client';

import { useState } from 'react';

const FAQ_EN = [
  {
    q: "What do you mean by '99% automation'? What's left for me to do?",
    a: "After setup, you only need to handle two things manually: configure your property to ASI's recommendations and hire line staff (housekeepers, maintenance). Everything else — guest communication, calendar management, cleaning coordination — the system handles automatically.",
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
    a: "ASI isn't just overbooking sync. We have a built-in smart Channel Manager. First, the system pulls in all your current channels via API. Then, once your property is positioned for the right audience, ASI automatically shifts away from underperforming channels, keeping only the most profitable ones. The system manages occupancy on its own — replacing a dedicated revenue manager.",
  },
  {
    q: 'How does the system handle pricing? Will it replace a revenue manager?',
    a: "ASI doesn't work like a professional revenue manager — it works better. No person can manually balance hundreds of variables in real time: competitor pricing, local events, OTA algorithms, and historical demand data. The system dynamically manages rates for your target audience, maximizing occupancy based on math, not guesswork.",
  },
  {
    q: 'I only have a few apartments. Is this system too complex for me?',
    a: "On the contrary — ASI lets you scale much faster through 99% automation. As you grow, you won't need to expand headcount by hiring booking agents, administrators, or dispatchers. Eliminating even one booking agent means an immediate and significant reduction in operating costs.",
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
    a: 'Three factors: first, complete savings on labor costs. Second, the built-in channel manager saves money on third-party services. Third, automated pricing and selection of the most profitable OTA channels eliminates vacancies and increases average revenue per booking.',
  },
  {
    q: 'How is ASI fundamentally different from existing CRM and PMS solutions?',
    a: "Any traditional CRM or Channel Manager is just an interface where you or your staff have to do the work. ASI is an active system. The software works for you. It's a digital autopilot that lets owners focus on strategy while properties manage themselves.",
  },
];

const FAQ_RU = [
  {
    q: 'Что вы имеете в виду под «99% автоматизации»? Что остается делать мне?',
    a: 'После запуска системы вам остается вручную делать только две вещи: упаковать объект по рекомендациям ASI и нанять линейный персонал (горничных, хоум-мастеров). Всю остальную операционную работу — от общения с гостями и управления календарями до координации клининга — система забирает на себя.',
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
    a: 'ASI — это не просто синхронизация от овербукинга. У нас встроен свой умный Channel Manager. Сначала система по API подтягивает все ваши текущие площадки. Затем, когда объект упакован под нужную аудиторию, ASI сама уводит его с неэффективных каналов, оставляя только самые прибыльные. Система сама управляет загрузкой, заменяя дорогого ревеню-менеджера.',
  },
  {
    q: 'Как система выстраивает ценообразование? Заменит ли она ревеню-менеджера?',
    a: 'ASI не работает как профессиональный ревеню-менеджер — она работает лучше. Физически ни один человек не в состоянии ежеминутно сводить сотни переменных: динамику цен конкурентов, локальные мероприятия, алгоритмы OTA и исторические данные спроса. Система динамически управляет тарифами под вашу ЦА, гарантируя максимальную загрузку и опираясь на математику, а не на догадки.',
  },
  {
    q: 'У меня всего несколько квартир. Не слишком ли это сложная система?',
    a: 'Наоборот, именно ASI позволяет масштабировать бизнес значительно быстрее за счёт 99% автоматизации. Вам не придётся по мере роста раздувать штат: нанимать бронистов, администраторов и диспетчеров. Отказ от одного только брониста в России — это моментальное сокращение операционных расходов примерно на 80 000 рублей в месяц.',
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
    a: 'За счёт трёх факторов. Первое: полная экономия на фонде оплаты труда. Второе: встроенный менеджер каналов экономит деньги на сторонних сервисах. Третье: автоматическое ценообразование и отбор самых прибыльных OTA-площадок исключают простои и увеличивают средний чек.',
  },
  {
    q: 'Чем ASI кардинально отличается от существующих CRM и PMS на рынке?',
    a: 'Любая классическая CRM или Channel Manager — это просто интерфейс, в котором вы или ваши сотрудники должны работать. ASI — это активная система. Программа работает за вас. Это цифровой автопилот, который позволяет владельцу заниматься стратегией, пока объекты сдаются сами.',
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
            className="rounded-xl border border-slate-800/90 bg-slate-900/40 overflow-hidden backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left text-slate-100 hover:bg-slate-800/35 transition-colors duration-200 text-lg"
            >
              <span className="font-medium leading-snug pr-2">{item.q}</span>
              <span
                className={`mt-0.5 shrink-0 text-slate-500 text-lg leading-none transition-transform duration-300 ease-out ${
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
                <p className="px-5 pb-5 pt-1 text-base text-slate-400 leading-relaxed">
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

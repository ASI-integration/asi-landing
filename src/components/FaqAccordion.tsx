'use client';

import { useState } from 'react';

const FAQ_EN = [
  {
    q: 'What does ASI automate today?',
    a: 'ASI automates routine guest communication and operational coordination when the required data, policy, and integration are available. Sensitive, ambiguous, payment, legal, or unsupported external actions go to an operator or a documented manual flow.',
  },
  {
    q: 'How are payment and access credentials handled?',
    a: 'ASI does not need raw card details for the pilot. Payments, when enabled, are handled by the configured payment provider. Access details are released only through configured readiness flows; direct lock automation depends on the specific supported integration.',
  },
  {
    q: 'Is ASI suitable for agencies and management companies?',
    a: 'Yes. ASI is designed around account-scoped properties, booking operations, roles, tasks, and exceptions. The exact automation level depends on the systems connected for that portfolio.',
  },
  {
    q: 'I already have a Channel Manager. Why do I need ASI?',
    a: 'ASI sits above the Channel Manager as an operational layer. During the pilot, connection and import may be manual or semi-automated. Direct API sync or publishing is enabled only for providers whose integration has been accepted; ASI does not claim automatic publishing to every OTA.',
  },
  {
    q: 'How does pricing work?',
    a: 'ASI can prepare pricing recommendations from seasonality, booking context, competition, and location signals. Those recommendations are not automatically published to booking platforms unless a specific provider integration has been enabled and accepted.',
  },
  {
    q: 'Is ASI useful for a small portfolio?',
    a: 'Yes. A small portfolio can use the same guided setup, communication, readiness, and exception workflows. The actual time or staffing savings depend on your workload and integrations; ASI does not promise a fixed ROI or headcount reduction.',
  },
  {
    q: 'Do I need smart locks?',
    a: 'No. Access can be handled with existing keys or key boxes. Automated PIN creation or lock control is only available when a supported lock integration is configured.',
  },
  {
    q: 'How does ASI handle cleaning and maintenance?',
    a: 'ASI can create, track, and escalate operational tasks and readiness checks. Automatic assignment or delivery to external workers depends on the configured workflow and integration; otherwise the task is handed to an operator.',
  },
  {
    q: 'How does ASI reduce risk with difficult cases?',
    a: 'ASI uses configured rules, verification signals, readiness checks, and operator escalation. It does not claim a universal guest blacklist or fully automatic screening across every booking platform.',
  },
  {
    q: 'How quickly does ASI pay for itself?',
    a: 'There is no guaranteed payback period. The business effect depends on portfolio size, current manual workload, connected systems, and which automation paths are enabled. Pilot results should be measured on the actual portfolio before making ROI claims.',
  },
  {
    q: 'How is ASI different from a CRM or PMS?',
    a: 'A CRM or PMS is primarily a system of record and control. ASI adds an execution and coordination layer: routine actions can move automatically when the policy and integration allow it, while exceptions and unsupported external actions stay with a human.',
  },
];

const FAQ_RU = [
  {
    q: 'Что ASI автоматизирует уже сейчас?',
    a: 'ASI автоматизирует типовые коммуникации с гостями и операционную координацию там, где есть нужные данные, правило и подключённая интеграция. Чувствительные, неоднозначные, платёжные, юридические и неподдерживаемые внешние действия передаются оператору или в документированный ручной процесс.',
  },
  {
    q: 'Как обрабатываются платежи и данные доступа?',
    a: 'В пилоте ASI не нужны полные данные банковской карты. Платежи, когда они включены, обрабатывает настроенный платёжный провайдер. Данные доступа выдаются только через настроенный контур готовности; прямое управление замком зависит от конкретной поддерживаемой интеграции.',
  },
  {
    q: 'Подходит ли ASI управляющим компаниям и агентствам?',
    a: 'Да. ASI строится вокруг аккаунта, объектов, бронирований, ролей, задач и исключений. Уровень автоматизации зависит от систем, которые реально подключены к конкретному портфелю.',
  },
  {
    q: 'У меня уже есть менеджер каналов. Зачем ASI?',
    a: 'ASI работает поверх менеджера каналов как операционный слой. На пилоте подключение и импорт могут быть ручными или полуавтоматическими. Прямая API-синхронизация и публикация включаются только для тех провайдеров, чья интеграция принята; ASI не обещает автоматическую публикацию во все OTA.',
  },
  {
    q: 'Как работает ценообразование?',
    a: 'ASI может готовить рекомендации по цене на основе сезона, контекста бронирования, конкурентов и данных локации. Рекомендации не публикуются на площадках автоматически, пока не включена и не принята конкретная интеграция.',
  },
  {
    q: 'ASI полезна для небольшого портфеля?',
    a: 'Да. Небольшой портфель может использовать тот же пошаговый setup, коммуникации, контроль готовности и обработку исключений. Экономия времени и штата зависит от реальной нагрузки и интеграций; фиксированную окупаемость ASI не обещает.',
  },
  {
    q: 'Нужны ли умные замки?',
    a: 'Нет. Можно работать с обычными ключами или кейбоксами. Автоматическая генерация PIN-кодов или управление замком доступны только при наличии поддерживаемой и настроенной интеграции.',
  },
  {
    q: 'Как ASI работает с уборкой и ремонтом?',
    a: 'ASI может создавать, отслеживать и эскалировать операционные задачи и проверки готовности. Автоматическое назначение или доставка задачи внешнему исполнителю зависит от настроенного процесса и интеграции; иначе задача передаётся оператору.',
  },
  {
    q: 'Как ASI снижает риск сложных случаев?',
    a: 'ASI использует настроенные правила, сигналы проверки, readiness-контур и эскалацию оператору. Система не заявляет универсальный глобальный чёрный список или полностью автоматический скрининг гостей на всех площадках.',
  },
  {
    q: 'Как быстро окупается ASI?',
    a: 'Гарантированного срока окупаемости нет. Результат зависит от размера портфеля, текущей ручной нагрузки, подключённых систем и включённых сценариев. Эффект нужно измерять на реальном пилоте.',
  },
  {
    q: 'Чем ASI отличается от CRM или PMS?',
    a: 'CRM и PMS в первую очередь хранят данные и дают интерфейс управления. ASI добавляет слой исполнения и координации: типовые действия могут двигаться автоматически там, где это разрешают правила и интеграции, а исключения и неподдерживаемые внешние действия остаются за человеком.',
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
                className={`mt-0.5 shrink-0 text-[var(--t-muted)] text-lg leading-none transition-transform duration-300 ease-out ${isOpen ? 'rotate-45' : ''}`}
                aria-hidden
              >
                +
              </span>
            </button>
            <div
              className={`grid overflow-hidden transition-[grid-template-rows] duration-500 ease-in-out motion-reduce:transition-none ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
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

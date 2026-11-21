import type { OwnerLang } from './context';

/**
 * Entirely fictional sales demonstration. Nothing here is derived from a
 * real booking, guest, sensor, channel manager, voice call, or payment.
 * Frontend-only data; never trigger external communications or payments.
 */
export type StoryRole = 'guest' | 'manager' | 'owner';
export type StoryStageId =
  | 'reservation' | 'communication' | 'change' | 'refund' | 'incident'
  | 'housekeeping' | 'resale' | 'lost-property' | 'corporate';
export type RefundPath = 'delegated' | 'approval';

export interface StoryStage {
  id: StoryStageId;
  time: string;
  heading: string;
  situation: string;
  decision: string;
  policy: string;
  view: Record<StoryRole, string[]>;
  artifact: string;
}

export function chooseRefundPath(requestedNights: number, delegatedMaxNights = 3): RefundPath {
  return Number.isInteger(requestedNights) && requestedNights > 0
    && requestedNights <= delegatedMaxNights ? 'delegated' : 'approval';
}

const RU: readonly StoryStage[] = [
  {
    id: 'reservation', time: 'День 0 · 12:04', heading: 'Новая бронь — цена и доступность',
    situation: 'Командированный бронирует апартаменты в Санкт-Петербурге на 8 ночей. ASI сверяет доступность и правила динамической цены.',
    decision: 'В учебном календаре появляется подтверждённая бронь и обновляется цена; конфликтующие даты закрыты.',
    policy: 'В рабочем продукте нужны подтверждённая интеграция с PMS/OTA и контроль двойного бронирования.',
    view: {
      guest: ['Бронь подтверждена. Инструкция по заселению придёт после проверки права доступа.', 'Параметры проживания и правила — в вашем сообщении.'],
      manager: ['Новая бронь: 8 ночей. Запись в календаре и задача подготовки объекта.', 'Канал продаж и синхронизация — в очереди интеграции.'],
      owner: ['Спрос и ценовые ограничения учтены в расчёте.', 'Владелец видит расчёт и историю изменения цены.'],
    },
    artifact: 'Календарь / карточка бронирования',
  },
  {
    id: 'communication', time: 'День 0–1', heading: '33 вопроса гостя — текст и голос',
    situation: 'Гость спрашивает о парковке, Wi-Fi, позднем въезде, командировочных документах и истории дома.',
    decision: 'Система готовит ответы на основе утверждённой базы объекта. Передача кодов доступа возможна только после проверки заселения.',
    policy: 'Голос, мессенджеры и выдача кодов здесь показаны как проектируемые интеграции, а не как работающие звонки.',
    view: {
      guest: ['«Где Wi-Fi?» — «Инструкция появится после подтверждения заселения».', '«А что за дом?» — «Вот краткая история, одобренная владельцем».'],
      manager: ['33 типовых обращения разложены по категориям: доступ, парковка, документы, местные советы.', 'Сложные вопросы требуют передачи ответственному человеку.'],
      owner: ['Журнал запросов, шаблоны ответов, потенциальные расходы на поддержку.', 'Доступ к данным гостя ограничен назначенной ролью.'],
    },
    artifact: 'Демонстрационный диалог / очередь обращений',
  },
  {
    id: 'change', time: 'День 2 · 09:18', heading: 'Гость хочет уехать раньше',
    situation: 'После заселения гость просит сократить проживание на три ночи и вернуть часть оплаты. От предложенной скидки за сохранение дат он отказывается.',
    decision: 'ASI предлагает изменить даты и показывает гостю понятный расчёт без спора и давления.',
    policy: 'До изменения реального OTA-бронирования необходимо согласие гостя и разрешение тарифных правил.',
    view: {
      guest: ['«Хочу выехать на три дня раньше. Можно вернуть разницу?»', '«Понимаю. Могу предложить изменить бронь; вот условия и расчёт».'],
      manager: ['Запрос изменения обнаружен. Предварительная проверка тарифа и статуса проживания.', 'Изменение календаря пока не подтверждено.'],
      owner: ['Владелец видит причину, перерасчёт и коммерческие альтернативы.', 'Никакого автоматического списания или возврата без правил.'],
    },
    artifact: 'Диалог и предварительный перерасчёт',
  },
  {
    id: 'refund', time: 'День 2 · 09:20', heading: 'Возврат: лимит полномочий',
    situation: 'Демонстрационная политика: автономное решение разрешено максимум на 3 ночи и только в рамках делегированного фонда.',
    decision: 'В пределах лимита — предварительно одобренный расчёт; сверх лимита — запрос владельцу.',
    policy: 'Денежные операции в этом сценарии не выполняются. Реальный возврат требует правил OTA, согласия и платёжной интеграции.',
    view: {
      guest: ['«Вот перерасчёт и срок ответа по вашему запросу».', '«Я сообщу, когда изменение будет подтверждено».'],
      manager: ['Порог 3 ночи и баланс делегированного фонда проверяются до решения.', 'При превышении полномочий задача уходит человеку.'],
      owner: ['История согласования и лимит фонда видны в карточке.', 'Четыре ночи — обязательное подтверждение владельца.'],
    },
    artifact: 'Реестр разрешений / предложение возврата',
  },
  {
    id: 'incident', time: 'День 3 · 18:42', heading: 'Датчик сообщает о задымлении',
    situation: 'Поступает сигнал дыма в здании. Источник сигнала ещё не подтверждён. Гость сейчас вне объекта.',
    decision: 'ASI формирует срочное предупреждение гостю в ранее согласованный канал и оповещения владельцу и управляющему.',
    policy: 'Чрезвычайные службы вызываются уполномоченным человеком или через отдельно проверенную сертифицированную интеграцию; симуляция ничего не отправляет.',
    view: {
      guest: ['«В здании зафиксирован сигнал о задымлении. Не возвращайтесь в помещение до разрешения ответственных служб».', 'Канал: ранее подтверждённый Telegram.'],
      manager: ['Срочное оповещение: установить источник тревоги, подтвердить связь с гостем и вызвать службы по инструкции.', 'Статусы доставки и подтверждения — отдельные события.'],
      owner: ['Пожарная тревога: нужен ответственный оператор и эскалация.', 'Пока нет подтверждения, ASI не утверждает, что источник находится в соседней квартире.'],
    },
    artifact: 'Панель инцидента / сообщения безопасности',
  },
  {
    id: 'housekeeping', time: 'День 3 · 19:10', heading: 'Уборка меняется из-за дыма и сажи',
    situation: 'После проверки менеджер фиксирует загрязнение объекта дымом. Требуется дополнительная уборка и, возможно, прачечная.',
    decision: 'ASI предлагает новый график, собирает подтверждения сотрудников и считает доплату за срочность по утверждённой политике.',
    policy: 'Новый график вступает в силу после согласия работников; удвоенная оплата — пример правила компании, не автоматическая норма закона.',
    view: {
      guest: ['«Мы проверяем состояние объекта. Сообщим о безопасном доступе и необходимых действиях».'],
      manager: ['Горничные А и Б: новая очередь задач и запросы подтверждения.', 'Дополнительная уборка, прачечная и срочность: проект работ.'],
      owner: ['Дополнительные часы и пример коэффициента x2 — отдельная строка расходов.', 'Оплата персоналу не проводится автоматически.'],
    },
    artifact: 'График горничных / смета допработ',
  },
  {
    id: 'resale', time: 'День 4 · 10:05', heading: 'Свободные даты снова продаются',
    situation: 'После подтверждённого изменения выезда и безопасного состояния объекта ранее занятые даты могут снова открыться.',
    decision: 'ASI предлагает цену с учётом спроса, публикует доступность через подтверждённый канал и фиксирует следующую бронь в учебном календаре.',
    policy: 'Нельзя открывать календарь до подтверждения изменения, готовности объекта и синхронизации OTA/PMS.',
    view: {
      guest: ['Новые даты выезда подтверждены. Гость получает итоговые документы.'],
      manager: ['Календарь открыт только после прохождения проверок безопасности и уборки.', 'Новая бронь добавлена в учебное расписание.'],
      owner: ['Повторная продажа высвободившихся ночей по более высокой учебной цене.', 'В одном окне видны дополнительная выручка и расходы на перестановки.'],
    },
    artifact: 'Динамический календарь / журнал цены',
  },
  {
    id: 'lost-property', time: 'День 5 · 11:35', heading: 'Забытый тубус с документами',
    situation: 'После выезда горничная сообщает о найденном тубусе. Гость уже в аэропорту Пулково.',
    decision: 'ASI готовит предложение доставки курьером за счёт компании по заранее заданному лимиту и только с согласия гостя.',
    policy: 'Адрес, телефон и содержимое находки не передаются третьим лицам без необходимого основания и согласия; реальный заказ курьера не создаётся.',
    view: {
      guest: ['«Мы обнаружили оставленный вами тубус. Хотите доставку в аэропорт?»', '«После вашего согласия подтвердим стоимость и адрес передачи».'],
      manager: ['Предмет зарегистрирован без публикации документов. Цепочка передачи — под учётом.', 'Курьер — только после согласия и проверки лимита.'],
      owner: ['Небольшой расход на лояльность сравнивается с ценностью постоянного корпоративного гостя.', 'Служебное согласование и чек в журнале.'],
    },
    artifact: 'Находки / доставка / разрешение расходов',
  },
  {
    id: 'corporate', time: 'После поездки', heading: 'Из одного гостя — корпоративный клиент',
    situation: 'Гость доволен заботой. ASI может предложить ему программу постоянного проживания и сотрудничество с работодателем.',
    decision: 'С согласия гостя ASI готовит персональное предложение. Обращение к корпоративному менеджеру требует отдельного разрешённого контакта.',
    policy: 'Не передавать HR историю проживания или личные данные без правового основания; не обещать последующие брони как гарантированный результат.',
    view: {
      guest: ['«Для будущих командировок доступна корпоративная программа. Хотите узнать условия?»'],
      manager: ['Лояльность и обратная связь доступны только в пределах подтверждённых прав.', 'Корпоративное предложение — отдельная задача продаж.'],
      owner: ['Путь от бронирования к повторному спросу виден в CRM.', 'Владелец видит потенциальную, а не гарантированную корпоративную выручку.'],
    },
    artifact: 'CRM / программа лояльности / партнёрская сеть',
  },
];

const EN: readonly StoryStage[] = [
  {
    id: 'reservation', time: 'Day 0 · 12:04', heading: 'A booking arrives — pricing and availability',
    situation: 'A business traveler books an apartment in Saint Petersburg for eight nights. ASI evaluates availability and pricing rules.',
    decision: 'The simulated calendar records the booking, closes unavailable nights and logs the price decision.',
    policy: 'Production requires verified PMS/OTA integration and double-booking protection.',
    view: {
      guest: ['Your stay is confirmed. Check-in instructions are released after access verification.', 'Your itinerary and house rules appear in your confirmation.'],
      manager: ['Eight-night booking: calendar slot and property-preparation task.', 'Channel synchronization requires a connected provider.'],
      owner: ['Pricing guardrails and demand signals shape the proposal.', 'Full record of price decisions is available.'],
    },
    artifact: 'Booking calendar / reservation card',
  },
  {
    id: 'communication', time: 'Days 0–1', heading: '33 guest questions, text and voice',
    situation: 'The guest asks about parking, Wi-Fi, late check-in, invoices and the history of the building.',
    decision: 'ASI drafts replies using owner-approved property knowledge; access codes are gated until check-in eligibility is verified.',
    policy: 'Voice and messaging shown here are planned integrations and sample transcripts, not completed real calls.',
    view: {
      guest: ['“Where is the Wi-Fi?” — “You will receive verified access details after check-in.”', '“What is this building’s story?” — An approved short history is presented.'],
      manager: ['33 sample enquiries grouped by access, parking, invoicing and local recommendations.', 'Escalation remains available for uncertain questions.'],
      owner: ['Guest-care transcript, suggested answers and support workload.', 'Guest personal data follows role-based permissions.'],
    },
    artifact: 'Guest chat / enquiry inbox',
  },
  {
    id: 'change', time: 'Day 2 · 09:18', heading: 'An early-checkout request',
    situation: 'After check-in, the guest asks to leave three nights early and receive a partial refund. They decline an offer to keep the original dates.',
    decision: 'ASI proposes amended dates, explains the options politely, and prepares an itemized estimate.',
    policy: 'Real reservation changes require the guest’s consent and the OTA/rate rules.',
    view: {
      guest: ['“I need to leave three nights earlier. Could I get a refund?”', '“I understand. Here are your options and the applicable terms.”'],
      manager: ['Change request flagged. Rate and stay status checked.', 'Calendar remains unchanged until authorized.'],
      owner: ['See projected revenue impact and alternatives.', 'No automatic transfer or refund outside the configured policy.'],
    },
    artifact: 'Conversation / change estimate',
  },
  {
    id: 'refund', time: 'Day 2 · 09:20', heading: 'Autonomy with a hard refund limit',
    situation: 'Illustrative policy: the delegated fund covers up to three nights, subject to available funds and rate conditions.',
    decision: 'Within limits, the system prepares an authorized decision. Four nights or more require owner approval.',
    policy: 'This simulation makes no real refund. A live refund needs consent, provider rules and a payment integration.',
    view: {
      guest: ['“Here is the estimate and expected decision window.”', '“I will confirm as soon as the change is authorized.”'],
      manager: ['Verify the three-night ceiling and remaining fund.', 'Escalate any amount exceeding the delegated authority.'],
      owner: ['See why the refund is or is not within delegated authority.', 'Four nights triggers an approval request.'],
    },
    artifact: 'Approval policy / delegated-fund ledger',
  },
  {
    id: 'incident', time: 'Day 3 · 18:42', heading: 'A smoke sensor triggers a safety alert',
    situation: 'A sensor reports smoke in the building. The source is not yet verified; the guest is away.',
    decision: 'ASI prepares urgent guest, manager and owner alerts in previously approved channels.',
    policy: 'Emergency services are contacted by an authorized human or validated certified integration. No messages are actually sent in this demo.',
    view: {
      guest: ['“Smoke has been reported in the building. Please do not return until emergency personnel confirm it is safe.”', 'Preferred channel: previously authorized Telegram.'],
      manager: ['Urgent: verify the alert, contact the guest, follow escalation and emergency procedures.', 'Delivery and acknowledgement are tracked separately.'],
      owner: ['Safety escalation requires an authorized incident lead.', 'The source is not assumed to be next door until verified.'],
    },
    artifact: 'Incident dashboard / safety notification',
  },
  {
    id: 'housekeeping', time: 'Day 3 · 19:10', heading: 'Housekeeping shifts change',
    situation: 'After a manager confirms smoke contamination, the property needs more cleaning and possibly laundry.',
    decision: 'ASI drafts an updated schedule, requests employee acknowledgement and calculates an urgency supplement.',
    policy: 'Changes take effect after staff acceptance; 2× pay is only an example of a company-approved rule.',
    view: {
      guest: ['“We are assessing the property and will update you when it is safe.”'],
      manager: ['Staff A and B receive revised draft shifts and confirmation requests.', 'Laundry and deep-cleaning added as conditional tasks.'],
      owner: ['Overtime and an illustrative 2× urgency multiplier appear in the cost forecast.', 'No wages are actually paid by the demo.'],
    },
    artifact: 'Staff roster / extra-service costs',
  },
  {
    id: 'resale', time: 'Day 4 · 10:05', heading: 'Freed dates are back on sale',
    situation: 'Once the stay change, safe occupancy and readiness are confirmed, the released nights can be sold again.',
    decision: 'ASI proposes updated pricing and records a new sample booking after simulated channel synchronization.',
    policy: 'Never release availability before change approval, safety clearance, cleaning and PMS/OTA sync.',
    view: {
      guest: ['Revised departure dates are confirmed and the guest receives final documents.'],
      manager: ['Calendar opens only when safety and housekeeping gates pass.', 'New simulated booking enters the schedule.'],
      owner: ['Released nights sell at a higher illustrative rate.', 'See extra revenue alongside staffing costs.'],
    },
    artifact: 'Availability / dynamic pricing ledger',
  },
  {
    id: 'lost-property', time: 'Day 5 · 11:35', heading: 'A forgotten tube of documents',
    situation: 'A housekeeper finds a document tube after checkout. The guest is already at Pulkovo airport.',
    decision: 'ASI drafts a goodwill courier offer under an expense cap, pending guest consent.',
    policy: 'Never disclose a guest’s documents, travel details or address to a courier without an appropriate legal basis and consent. No courier is booked here.',
    view: {
      guest: ['“We found a tube you left behind. Would you like us to arrange airport delivery?”', '“We will confirm the cost and delivery point after your approval.”'],
      manager: ['Item recorded with restricted access; chain of custody tracked.', 'Courier request waits for guest consent and budget checks.'],
      owner: ['Small loyalty expense compared with potential repeat business.', 'Expense authorization and receipt trail visible.'],
    },
    artifact: 'Lost property / approved goodwill expense',
  },
  {
    id: 'corporate', time: 'After the trip', heading: 'A guest becomes a corporate opportunity',
    situation: 'The traveler appreciates the service. ASI can offer a loyalty plan and explore a workplace travel partnership.',
    decision: 'With consent, ASI drafts a relevant offer; any employer outreach requires an approved lawful contact.',
    policy: 'Do not send stay history or personal data to HR without a lawful basis; projected sales are not guaranteed bookings.',
    view: {
      guest: ['“We have an optional corporate travel program. Would you like the details?”'],
      manager: ['Feedback and loyalty records are visible under approved permissions.', 'Corporate outreach becomes a reviewed sales task.'],
      owner: ['See a possible shift from one booking to repeat corporate demand.', 'CRM value is a forecast, not actual booked revenue.'],
    },
    artifact: 'CRM / loyalty / partner network',
  },
];

export function storyScenes(lang: OwnerLang): readonly StoryStage[] {
  return lang === 'ru' ? RU : EN;
}

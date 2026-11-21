import type { OwnerLang } from './context';
import { chooseRefundPath, type StoryStageId } from './journey-story';

export interface JourneyBoard {
  title: string;
  footnote: string;
  items: readonly { label: string; value: string }[];
}

const RU_BOARD: Record<StoryStageId, JourneyBoard> = {
  reservation: {
    title: 'Карточка брони · учебный объект',
    items: [
      { label: 'Номер', value: 'DEMO-2148' },
      { label: 'Проживание', value: '8 ночей' },
      { label: 'Цена за ночь', value: '7 300 ₽ (пример)' },
      { label: 'Доступность', value: '8 ночей заняты' },
    ],
    footnote: 'Учебная запись, не связанная с каналами бронирования.',
  },
  communication: {
    title: 'Входящие обращения · пример',
    items: [
      { label: 'Вопросов гостя', value: '33' },
      { label: 'Канал', value: 'Чат / голос: макет' },
      { label: 'Знания объекта', value: 'Только утверждённые' },
      { label: 'Коды замка', value: 'После проверки' },
    ],
    footnote: 'Показан текст ответа; настоящий голосовой звонок не выполняется.',
  },
  change: {
    title: 'Запрос изменить бронь',
    items: [
      { label: 'Исходный срок', value: '8 ночей' },
      { label: 'Новый срок', value: '5 ночей' },
      { label: 'Удержать гостя', value: 'Скидка предложена' },
      { label: 'Решение гостя', value: 'Отказался' },
    ],
    footnote: 'Календарь не открывается до принятого изменения брони.',
  },
  refund: {
    title: 'Делегированные полномочия',
    items: [
      { label: 'Запрошено', value: '3 ночи' },
      { label: 'Лимит', value: '3 ночи' },
      { label: 'Решение', value: 'Расчёт в пределах лимита' },
      { label: 'Факт перевода', value: '0 ₽ — симуляция' },
    ],
    footnote: 'Реальный возврат требует проверки фонда, условий и платёжного провайдера.',
  },
  incident: {
    title: 'Ситуационный центр безопасности',
    items: [
      { label: 'Сигнал', value: 'Дым · источник неясен' },
      { label: 'Гость', value: 'Предупреждение: макет' },
      { label: 'Управляющий', value: 'Эскалация: макет' },
      { label: 'Службы', value: 'Только оператор/интеграция' },
    ],
    footnote: 'Никаких реальных вызовов и сообщений.',
  },
  housekeeping: {
    title: 'Изменённые смены · проект расписания',
    items: [
      { label: 'Горничная А', value: 'Ожидает подтверждения' },
      { label: 'Горничная Б', value: 'Ожидает подтверждения' },
      { label: 'Прачечная', value: 'Дополнительная задача' },
      { label: 'Срочные часы', value: '×2 по примеру правил' },
    ],
    footnote: 'Начисление зарплаты не создаётся. Перестановка действительна только после согласия.',
  },
  resale: {
    title: 'Освободившиеся ночи · учебный календарь',
    items: [
      { label: 'Старый тариф', value: '7 300 ₽ / ночь' },
      { label: 'Новый тариф', value: '8 100 ₽ / ночь (пример)' },
      { label: 'OTA-синхронизация', value: 'В сценарии подтверждена' },
      { label: 'Новая бронь', value: 'DEMO-2149' },
    ],
    footnote: 'Это сценарный результат, а не реальные деньги или подтверждённая бронь.',
  },
  'lost-property': {
    title: 'Карточка найденной вещи',
    items: [
      { label: 'Предмет', value: 'Тубус (без содержимого)' },
      { label: 'Гость', value: 'Предположительно в Пулково' },
      { label: 'Курьер', value: 'Ожидает согласия' },
      { label: 'Расход', value: 'В лимите лояльности' },
    ],
    footnote: 'Передача документов и заказ курьера не выполняются.',
  },
  corporate: {
    title: 'CRM · возможности повторных продаж',
    items: [
      { label: 'Сегмент', value: 'Деловая поездка' },
      { label: 'Лояльность', value: 'Предложение подготовлено' },
      { label: 'Контакт работодателя', value: 'Требует разрешения' },
      { label: 'Повторная выручка', value: 'Прогноз, не факт' },
    ],
    footnote: 'История проживания не передаётся работодателю автоматически.',
  },
};

const EN_BOARD: Record<StoryStageId, JourneyBoard> = {
  reservation: {
    title: 'Sample reservation record',
    items: [
      { label: 'Reservation', value: 'DEMO-2148' },
      { label: 'Stay', value: '8 nights' },
      { label: 'Nightly rate', value: 'Illustrative' },
      { label: 'Availability', value: '8 nights blocked' },
    ],
    footnote: 'A fictional calendar entry, not connected to booking channels.',
  },
  communication: {
    title: 'Guest enquiry desk',
    items: [
      { label: 'Questions', value: '33' },
      { label: 'Channel', value: 'Chat / voice mockup' },
      { label: 'Knowledge', value: 'Owner-approved only' },
      { label: 'Smart-lock codes', value: 'After verification' },
    ],
    footnote: 'Sample text transcript; no real voice call is made.',
  },
  change: {
    title: 'Reservation change request',
    items: [
      { label: 'Original stay', value: '8 nights' },
      { label: 'Revised stay', value: '5 nights' },
      { label: 'Retention offer', value: 'Presented' },
      { label: 'Guest decision', value: 'Declined' },
    ],
    footnote: 'Availability is not released until a valid booking change is accepted.',
  },
  refund: {
    title: 'Delegated spending controls',
    items: [
      { label: 'Requested', value: '3 nights' },
      { label: 'Policy ceiling', value: '3 nights' },
      { label: 'Decision', value: 'Within policy estimate' },
      { label: 'Funds sent', value: '0 — simulation' },
    ],
    footnote: 'Real money movement requires approved terms and payment integration.',
  },
  incident: {
    title: 'Safety incident command panel',
    items: [
      { label: 'Sensor', value: 'Smoke · source unknown' },
      { label: 'Guest', value: 'Alert mockup' },
      { label: 'Manager', value: 'Escalation mockup' },
      { label: 'Responders', value: 'Human/certified link' },
    ],
    footnote: 'No real notifications or emergency dispatch.',
  },
  housekeeping: {
    title: 'Proposed staff roster',
    items: [
      { label: 'Housekeeper A', value: 'Confirmation pending' },
      { label: 'Housekeeper B', value: 'Confirmation pending' },
      { label: 'Laundry', value: 'Extra job proposed' },
      { label: 'Urgent hours', value: 'Illustrative 2× policy' },
    ],
    footnote: 'No payroll and no live shift changes.',
  },
  resale: {
    title: 'Released inventory · sample calendar',
    items: [
      { label: 'Old rate', value: 'Illustrative base rate' },
      { label: 'New rate', value: 'Illustrative higher rate' },
      { label: 'OTA sync', value: 'Assumed in scenario' },
      { label: 'New booking', value: 'DEMO-2149' },
    ],
    footnote: 'Fictional revenue opportunity, not an actual booking.',
  },
  'lost-property': {
    title: 'Lost-property record',
    items: [
      { label: 'Item', value: 'Document tube' },
      { label: 'Traveler', value: 'At Pulkovo (scenario)' },
      { label: 'Courier', value: 'Awaiting consent' },
      { label: 'Expense', value: 'Goodwill cap' },
    ],
    footnote: 'No real courier booking or document disclosure.',
  },
  corporate: {
    title: 'Corporate opportunity · CRM',
    items: [
      { label: 'Guest segment', value: 'Business traveler' },
      { label: 'Loyalty offer', value: 'Drafted' },
      { label: 'Employer contact', value: 'Consent required' },
      { label: 'Repeat revenue', value: 'Forecast only' },
    ],
    footnote: 'No guest records are sent to an employer.',
  },
};

export function storyEvidence(lang: OwnerLang, id: StoryStageId, refundNights = 3): JourneyBoard {
  const board = lang === 'ru' ? RU_BOARD[id] : EN_BOARD[id];
  if (id !== 'refund') return board;
  const path = chooseRefundPath(refundNights);
  if (lang === 'ru') {
    return {
      ...board,
      items: [
        { label: 'Запрошено', value: String(refundNights) + ' ночи' },
        { label: 'Лимит', value: '3 ночи' },
        { label: 'Решение', value: path === 'delegated' ? 'В рамках полномочий' : 'Согласование владельца' },
        { label: 'Факт перевода', value: '0 ₽ — симуляция' },
      ],
    };
  }
  return {
    ...board,
    items: [
      { label: 'Requested', value: String(refundNights) + ' nights' },
      { label: 'Policy ceiling', value: '3 nights' },
      { label: 'Decision', value: path === 'delegated' ? 'Within delegated limits' : 'Owner approval required' },
      { label: 'Funds sent', value: '0 — simulation' },
    ],
  };
}

import type { OwnerLang, OwnerVertical } from '@/lib/owner-console/context';

export interface CatalogRow {
  title: string;
  meta: string;
  status: string;
}

const PROPERTIES: Record<OwnerLang, Record<OwnerVertical | 'platform', CatalogRow[]>> = {
  en: {
    hospitality: [
      { title: 'Cabin 412', meta: 'Harbor row · checkout today', status: 'Turnover' },
      { title: 'Cabin 218', meta: 'Garden row · stay in progress', status: 'Occupied' },
      { title: 'Cabin 105', meta: 'Loft · vacant', status: 'Inspection due' },
    ],
    real_estate: [
      { title: 'Unit 12, Lesnaya 4', meta: 'Residential lease', status: 'Tenant request' },
      { title: 'Unit 3, Sadovaya 9', meta: 'Renewal this month', status: 'Review' },
      { title: 'Unit 7, Tverskaya 15', meta: 'Vacant', status: 'Viewing tomorrow' },
    ],
    industrial: [
      { title: 'Line B, press 4', meta: 'Planned stop', status: 'Maintenance window' },
      { title: 'Warehouse 2, dock 6', meta: 'Inbound freight', status: 'Due today' },
      { title: 'Compressor hall', meta: 'Utilities', status: 'Inspection' },
    ],
    marketplaces: [
      { title: 'Storefront North', meta: '14 open orders', status: 'Fulfillment' },
      { title: 'Storefront East', meta: '3 buyer disputes', status: 'Review' },
      { title: 'Storefront West', meta: 'Payout Friday', status: 'Pending' },
    ],
    platform: [
      { title: 'Hospitality', meta: 'Cabins, stays, housekeeping', status: 'Ready' },
      { title: 'Real Estate', meta: 'Units, tenants, viewings', status: 'Ready' },
      { title: 'Industrial', meta: 'Lines, docks, inspections', status: 'Ready' },
      { title: 'Marketplaces', meta: 'Storefronts, orders, payouts', status: 'Ready' },
    ],
  },
  ru: {
    hospitality: [
      { title: 'Номер 412', meta: 'Корпус у гавани · выезд сегодня', status: 'Оборот' },
      { title: 'Номер 218', meta: 'Садовый корпус · гость проживает', status: 'Занят' },
      { title: 'Номер 105', meta: 'Лофт · свободен', status: 'Нужна проверка' },
    ],
    real_estate: [
      { title: 'Кв. 12, Лесная 4', meta: 'Жилая аренда', status: 'Запрос жильца' },
      { title: 'Кв. 3, Садовая 9', meta: 'Продление в этом месяце', status: 'Проверка' },
      { title: 'Кв. 7, Тверская 15', meta: 'Свободна', status: 'Показ завтра' },
    ],
    industrial: [
      { title: 'Линия B, пресс 4', meta: 'Плановая остановка', status: 'Окно ремонта' },
      { title: 'Склад 2, док 6', meta: 'Входящий груз', status: 'Сегодня' },
      { title: 'Компрессорная', meta: 'Инженерия', status: 'Осмотр' },
    ],
    marketplaces: [
      { title: 'Витрина Север', meta: '14 открытых заказов', status: 'Сборка' },
      { title: 'Витрина Восток', meta: '3 спора покупателей', status: 'Разбор' },
      { title: 'Витрина Запад', meta: 'Выплата в пятницу', status: 'Ожидание' },
    ],
    platform: [
      { title: 'Гостеприимство', meta: 'Номера, заезды, горничные', status: 'Готово' },
      { title: 'Недвижимость', meta: 'Объекты, жильцы, показы', status: 'Готово' },
      { title: 'Промышленность', meta: 'Линии, доки, осмотры', status: 'Готово' },
      { title: 'Маркетплейсы', meta: 'Витрины, заказы, выплаты', status: 'Готово' },
    ],
  },
};

const TASKS: Record<OwnerLang, Record<OwnerVertical | 'platform', CatalogRow[]>> = {
  en: {
    hospitality: [
      { title: 'HK-14 cabin 412', meta: 'A. Petrova · housekeeping', status: 'Assigned' },
      { title: 'Minibar restock 218', meta: 'Evening shift', status: 'Queued' },
      { title: 'Guest message 105', meta: 'Late checkout request', status: 'Exception' },
    ],
    real_estate: [
      { title: 'Leak report, unit 12', meta: 'Plumber on call', status: 'Assigned' },
      { title: 'Lease packet, unit 3', meta: 'Owner review', status: 'Queued' },
    ],
    industrial: [
      { title: 'Press 4 lubrication', meta: 'Shift lead', status: 'Assigned' },
      { title: 'Dock 6 receiving', meta: 'Two handlers', status: 'Queued' },
    ],
    marketplaces: [
      { title: 'North pick wave', meta: '4 pickers', status: 'Assigned' },
      { title: 'East dispute replies', meta: 'Desk lead', status: 'Queued' },
    ],
    platform: [
      { title: 'Pick a vertical', meta: 'Tasks follow the selected vertical', status: 'Waiting' },
    ],
  },
  ru: {
    hospitality: [
      { title: 'HK-14 номер 412', meta: 'А. Петрова · горничная', status: 'Назначено' },
      { title: 'Мини-бар 218', meta: 'Вечерняя смена', status: 'В очереди' },
      { title: 'Сообщение гостя 105', meta: 'Поздний выезд', status: 'Исключение' },
    ],
    real_estate: [
      { title: 'Протечка, кв. 12', meta: 'Сантехник на вызове', status: 'Назначено' },
      { title: 'Пакет договора, кв. 3', meta: 'Проверка собственника', status: 'В очереди' },
    ],
    industrial: [
      { title: 'Смазка пресса 4', meta: 'Старший смены', status: 'Назначено' },
      { title: 'Приёмка дока 6', meta: 'Два грузчика', status: 'В очереди' },
    ],
    marketplaces: [
      { title: 'Волна сборки «Север»', meta: '4 сборщика', status: 'Назначено' },
      { title: 'Ответы по спорам «Восток»', meta: 'Старший смены', status: 'В очереди' },
    ],
    platform: [
      { title: 'Выберите вертикаль', meta: 'Задачи зависят от выбранной вертикали', status: 'Ожидание' },
    ],
  },
};

export function catalogRows(kind: 'properties' | 'tasks', lang: OwnerLang, vertical: OwnerVertical | null): CatalogRow[] {
  const key = vertical ?? 'platform';
  return (kind === 'properties' ? PROPERTIES : TASKS)[lang][key];
}

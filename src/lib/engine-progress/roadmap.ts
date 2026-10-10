/** ASI Engine milestones. Snapshot from the owner's 2026-10-10 roadmap.
 * Static planning statuses are NOT runtime or release authorization.
 * Only matching live evidence may override the CI steps (2.1–2.4).
 */
export type EngineProgressStatus = 'done' | 'in_progress' | 'blocked' | 'not_started' | 'unknown';
export type EngineMilestone = { id: number; group: string; title: string; pass: string };
export type EngineStep = { id: string; milestoneId: number; title: string; initialStatus: EngineProgressStatus };
export const ENGINE_ROADMAP_SNAPSHOT = '2026-10-10';

export const ENGINE_MILESTONES: EngineMilestone[] = [
  {id:1,group:'Диспетчер v1',title:'Кандидат кода опубликован',pass:'Код, последовательные синтетические циклы и Draft PR подтверждены'},
  {id:2,group:'Диспетчер v1',title:'CI Windows + Ubuntu полностью зелёный',pass:'Все три обязательных GitHub CI jobs на одном опубликованном SHA — PASS'},
  {id:3,group:'Диспетчер v1',title:'Независимый аудит точного SHA',pass:'Независимый audit опубликованного HEAD: source, CI и security'},
  {id:4,group:'Диспетчер v1',title:'Защищённая рабочая среда',pass:'Доказаны владелец, права, изоляция и приватный TEMP'},
  {id:5,group:'Диспетчер v1',title:'Доверенные подтверждения провайдеров',pass:'Настоящий защищённый issuer, nonce, одноразовость, проверка receipt'},
  {id:6,group:'Диспетчер v1',title:'Первый реальный цикл 1/1',pass:'Реальный запуск, результат, проверка и журнал без дублей'},
  {id:7,group:'Диспетчер v1',title:'Три последовательных реальных цикла',pass:'3/3, рестарт, отказ, recovery и полный журнал'},
  {id:8,group:'Диспетчер v1',title:'Dispatcher v1 — LIMITED GO',pass:'Явный owner GO, один поток, остановка и rollback'},
  {id:9,group:'Движок v1',title:'Единая долговечная очередь задач',pass:'Приоритеты, lease, checkpoint, журнал и resume'},
  {id:10,group:'Движок v1',title:'Замкнутый цикл разработки',pass:'Задача → разработчик → reviewer → исправление → CI → итог'},
  {id:11,group:'Движок v1',title:'Несколько провайдеров и резервирование',pass:'Два реально независимых провайдера и безопасный fallback'},
  {id:12,group:'Движок v1',title:'Качество, ресурсы и безопасность',pass:'Бюджет, лимиты, стоп, идемпотентность и качество'},
  {id:13,group:'Движок v1',title:'Понятная панель статусов',pass:'События задач, скорость, ошибки и ожидаемые действия'},
  {id:14,group:'Движок v1',title:'Масштабирование 1 → 3 → 10 потоков',pass:'Качество и безопасность отдельно доказаны на каждой ступени'},
  {id:15,group:'Движок v1',title:'Engine v1 MVP — GO',pass:'Ограниченный автономный цикл принят владельцем'},
  {id:16,group:'Интеграции/пилот',title:'Booking Ops ↔ движок',pass:'Guest intake → CRM → оператор/ответ с privacy и dedup'},
  {id:17,group:'Интеграции/пилот',title:'Пилот у Стригунова',pass:'Один объект, 20–30 сценариев, метрики, owner GO'},
  {id:18,group:'Интеграции/пилот',title:'Отдельные контуры Ким / Орис',pass:'Обособленные очереди и human/reviewer QA'},
  {id:19,group:'Будущее',title:'Эксперимент 20 → 100+ потоков',pass:'Без обещания production, только после стабильного Engine v1'},
];

/** Source step titles from ASI_Interactive_Roadmap.xlsx (63 rows).
 * Keep stage order and IDs stable for external evidence integrations.
 */
const ROWS = `
1.1|Базовый Dispatcher v1 code-only
1.2|Проверка synthetic 1/1 и 3/3
1.3|Публикация Dispatcher в PR #165
2.1|Ubuntu runtime security/staging
2.2|Windows runtime security/staging
2.3|Windows artifact/mock-control — вся приёмка
2.4|Общий CI на одном новом SHA
3.1|Exact-head source/security review
3.2|Проверить 341-файловый артефакт
3.3|Решение GO по коду (не live)
4.1|Выбрать доверенную host среду
4.2|Неизменяемые байты и приватный TEMP
4.3|Подтвердить владельца, ACL, roots
4.4|Проверка safe shutdown/rollback
5.1|Issuer вне недоверенного provider процесса
5.2|Nonce одноразовый и атомарный
5.3|Жёсткая привязка receipt
5.4|Окончательная проверка без доверия к caller
6.1|Подключить реального исполнителя
6.2|Задание 1/1
6.3|Ручной стоп/возобновление
7.1|Три живые последовательные задачи
7.2|Рестарт посередине
7.3|Сценарий отказа
7.4|Отчёт независимого аудитора
8.1|Definition of Done для Dispatcher v1
8.2|Ограниченный запуск с защитами
8.3|Rollback/kill switch
9.1|Единая очередь, lease, checkpoint
9.2|Перенос между исполнителями
9.3|Восстановление после ошибки
10.1|Постановка → исполнение
10.2|Рецензия → исправление
10.3|CI → вердикт владельцу
10.4|Bounded autonomous loop
11.1|Второй независимый provider
11.2|Fallback при недоступности
11.3|Provider budget / SLA
12.1|Один источник качества
12.2|Тест отказов/ошибочных ответов
12.3|Глобальные лимиты
13.1|Единая карточка задачи
13.2|Панель по проектам
13.3|События вместо hourly radar
14.1|Нагрузка при 1 потоке
14.2|3 независимых потока
14.3|10 потоков
14.4|Деградация/аварийный откат
15.1|Сквозная приёмка Engine v1
15.2|Финансовая управляемость
15.3|Owner GO на MVP
16.1|Guest intake/Telegram/email
16.2|Privacy + rate-limit + dedup
16.3|Human-on-exceptions
17.1|Один объект, 20–30 сценариев
17.2|Реальные показатели
17.3|Решение о расширении
18.1|Ким как отдельная очередь
18.2|Орис как отдельная очередь
18.3|Межпроектные квоты
19.1|Сначала измерить 10 потоков
19.2|20 потоков — controlled test
19.3|100+ — только исследование
`.trim();

const DONE = new Set(['1.1','1.2','1.3','2.1','2.2']);
const IN_PROGRESS = new Set(['2.3','9.1','16.1']);
const BLOCKED = new Set(['4.1','4.2','4.3','5.1','5.2','16.2']);

export const ENGINE_STEPS: EngineStep[] = ROWS.split('\n').map((row) => {
  const divider = row.indexOf('|');
  const id = row.slice(0, divider);
  const title = row.slice(divider + 1);
  return {
    id,
    milestoneId: Number(id.split('.')[0]),
    title,
    initialStatus: DONE.has(id) ? 'done' : IN_PROGRESS.has(id) ? 'in_progress' : BLOCKED.has(id) ? 'blocked' : 'not_started',
  };
});

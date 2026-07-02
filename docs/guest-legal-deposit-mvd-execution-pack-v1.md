# Guest Legal, Deposit & MVD Execution Pack v1

## Назначение

Модуль переводит существующие ручные заглушки в исполнимый операторский контур:

`данные гостя -> документы -> договор -> залог -> МВД -> готовность к заезду`.

Внешние вызовы OkiDoki, платёжного провайдера и МВД не выполняются. Реальные сообщения не отправляются. Скан-копии, полные номера документов, данные карт, платёжные секреты, коды доступа и учётные данные не сохраняются.

## Аудит исходного состояния

| Область | До v1 | Классификация | Изменение |
|---|---|---|---|
| `booking_guest_documents` | Ручные `requested/received/verified`, поле для маскированного номера | `semi_automatic` | Добавлены точные промежуточные и блокирующие статусы; сканы запрещены |
| `booking_contracts` | `prepared/sent/signed`, provider-заглушка | `placeholder` | Черновик, ручная подпись и provider-placeholder разделены |
| `booking_deposits` | `requested/received/waived`, без платежного вызова | `placeholder` | Черновик запроса, ручная оплата, provider-placeholder, спор и ручная отмена разделены |
| `booking_mvd_reports` | `prepared/submitted/accepted`, без отправки | `placeholder` | Черновик, экспорт, ручная/provider отправка, ручное принятие и `not_required` разделены |
| Lifecycle gates | Этапы документов, договора, залога и МВД существовали | `semi_automatic` | Черновики больше не завершают итоговые gates; только безопасные ручные/provider статусы |
| Pre-check-in | МВД submission был предупреждением, а не блокером | `missing` | `mvd_report_submitted` стал обязательным; добавлен legal/availability blocker |
| Check-in Execution | Инструкции можно было подготовить до отдельной legal-проверки | `blocked` | Guard вызывается перед подготовкой, очередью и отметкой отправки |
| Availability | Отдельная защита от пересечений уже работала | `automatic` | Результат `no_conflict` включён в legal readiness |
| Communication intents | Запросы документов/залога/МВД и инструкции существовали | `semi_automatic` | Confirmation/check-in/access intents получают legal guard; безопасные запросы разрешены |
| Booking Intake | Собирает гостя, объект и даты | `semi_automatic` | Используется как источник безопасных данных, без копирования чувствительных полей |
| Pilot Auto-Run | Инициализировал placeholder-контур | `placeholder` | Создаёт только запрос/договор/залог/МВД drafts и останавливается на ручных блокерах |
| Booking Ops UI | Компактная карточка уже существовала | `manual` | Добавлены readiness, availability, next action и точные ручные действия |
| Property Knowledge UI | Нет контекста выбранной брони | `missing` | Панель не добавлена: условие «если есть booking context» не выполняется |

## Модель данных

Переиспользуются четыре существующие таблицы. Добавлены:

- `booking_guest_legal_readiness` — единый снимок готовности, блокеры, предупреждения и безопасное резюме;
- `booking_legal_execution_events` — операторский журнал безопасных событий.

Обе таблицы имеют RLS, закрыты для `anon` и `authenticated`, доступны серверному `service_role`. Новые таблицы создаются с явными grant, что учитывает актуальное изменение Supabase по Data API exposure.

## Статусы и правила готовности

Поддерживаются все статусы из ТЗ для документов, договора, залога, МВД и итоговой legal readiness. Старые значения оставлены в DB constraint только для совместимости с уже записанными данными; новый сервис нормализует их в v1-модель.

`ready_for_checkin` возможен только одновременно при:

- availability = `no_conflict`;
- documents = `verified`;
- contract = `signed_manual` или явно проверенный provider-placeholder;
- deposit = `paid_manual`, проверенный provider-placeholder или `waived_manual` с причиной;
- MVD = `not_required` с причиной, `submitted_manual`, проверенный provider-placeholder или `accepted_manual`;
- отсутствии явной операторской блокировки.

Provider-placeholder даёт `ready_for_operator_review`, а не тихое автоматическое подтверждение.

## Безопасность данных

- Документ: только категория, флаг получения, маскированная ссылка, недостающие поля и безопасная заметка.
- Договор: только безопасные данные черновика; `draft_ready` не означает подпись.
- Залог: только сумма/валюта и статус; платёжная операция и данные карты отсутствуют.
- МВД: только draft/export metadata; сетевой отправки нет.
- API отбрасывает небезопасные metadata keys и значения, похожие на длинные номера.
- Ручные завершения требуют отдельного operator action; waiver и `not_required` требуют причину.

## API и UI

Защищённые endpoints:

- `GET /api/dashboard/guest-legal/status`
- `POST /api/dashboard/guest-legal/action`
- `GET /api/dashboard/guest-legal/explain`
- `GET /api/dashboard/guest-legal/events`

Чтение требует сессию CRM-оператора, изменение — Ops Admin. Панель Booking Ops остаётся компактной; дополнительные действия свёрнуты.

## Ограничения v1

- Нет юридической проверки содержания договора.
- Нет хранения файлов документов.
- Нет реальной электронной подписи.
- Нет реального платежа или автоматической сверки банка.
- Нет отправки или получения результата МВД.
- Provider-placeholder требует проверки оператора.
- Property Knowledge не показывает booking-панель, пока в этой поверхности нет выбранной брони.

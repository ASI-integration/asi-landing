# Partner Revenue Intelligence & Shadow Pricing v1

## Контракт продукта

Поток v1:

`Partner Historical/Live Data → authenticated credential → partner_account_binding → partner_property_binding → canonical properties.id → existing ASI Pricing Core → shadow recommendation → confidence → backtest/pilot KPI → human feedback`.

`shadow` всегда означает рекомендацию без изменения цены. В этом контуре нет записи в `final_price`, изменения тарифа партнёра, OTA rate push, вызова channel manager, реального адаптера Apart Sharing или автоматического применения. Автоценообразование возможно только как будущий отдельно контролируемый этап.

## Аудит существующего pricing core

### Production-real

- `booking_pricing_profiles`: сохранённые профиль, стратегия, base/min/max, валюта и guardrails.
- `booking_property_audience_profiles`: сохранённый вывод аудитории и confidence.
- `booking_pricing_market_signals`: сохранённые ручные/import/internal и placeholder-сигналы.
- `booking_tariff_grid_days`: сохранённая дневная сетка рекомендации с причинами.
- `booking_pricing_recommendation_runs`: история запусков.
- `recommendPriceForDate`: рабочая серверная формула day-of-week, seasonality, lead time, competitor, supply, events, weather, audience, strategy и clamp.
- `PricingIntelligencePanel`: рабочий Booking Ops UI над этими таблицами и действиями.

### Manual, placeholder, mock и UI-only

- Manual: создание/редактирование профиля, ручные market snapshots, approval и notes.
- Placeholder: источники `weather_provider_placeholder`, `events_provider_placeholder`, `market_provider_placeholder`; `auto_apply_enabled` и `auto_applied_placeholder` не означают live OTA write.
- Mock/synthetic: только test/demo fixtures; они маркируются `synthetic_demo` и `SYNTHETIC DEMO DATA ONLY`.
- UI-only: пользовательские статусы/кнопки панели не являются внешним применением цены.

### Scope и совместимость

Старые pricing-таблицы имеют `property_id` без `account_id` и без tenant composite FK. Их нельзя напрямую открывать partner API. Старые functions также принимают internal property setup/profile UUID и поэтому небезопасны как partner input. Новый слой никогда не принимает эти UUID: он сначала разрешает external property ID через активный binding, затем по canonical property требует ровно один полный профиль. Отсутствие, disabled/conflicting binding или 0/2+ профилей закрывает запрос.

Без изменений переиспользуются расчёт рекомендации, стратегия, audience weights, market factors, transparent adjustment reasons и min/max clamp. Для исторического backtest непригодны `final_price`, `approved`, `auto_applied_placeholder`, readiness/workflow status и run timestamps: это состояние рекомендации/оператора, а не наблюдавшиеся цена, inventory, продажи или revenue.

## Endpoint и события

`POST /api/partner/v1/revenue/events`, Node runtime, authentication тем же credential contract, что Partner Communication.

Общий envelope имеет `schemaVersion: partner.revenue.v1`, bounded `eventId`, ISO `occurredAt`, external `partner.partnerId`, external `partner.accountId`, external `property.propertyId`. Internal account/property/profile IDs запрещены во входе и ответе.

Поддерживаются только:

1. `revenue.observation.recorded` — одна нормализованная ночь.
2. `pricing.shadow.requested` — 1–90 уникальных stay dates; используется уже сохранённое наблюдение.
3. `pricing.recommendation.feedback` — `accepted | rejected | ignored`, opaque recommendation ref и необязательный bounded reason code.

Exact replay возвращает прежние `auditRef`/public refs и `duplicate: true`. Тот же event ID с другим normalized content возвращает HTTP 409 `partner_event_conflict`. Уникальность в БД является authoritative и tenant-bound.

## Nightly observation

Обязательные поля: `stayDate`, `currentPrice >= 0`, `availableInventory >= 0`, `soldInventory >= 0` и не больше availability, `realizedRoomRevenue >= 0`, ISO-4217-подобная трёхбуквенная `currency`.

Необязательные: `bookingLeadDays`, `bookingsCreated`, `cancellations`, `minStay`, `closedToArrival`. Counts bounded; inventory не ограничен моделью одного апартамента. Endpoint всегда нормализует source как `partner_supplied`; `synthetic_demo` существует только во внутреннем явно маркированном fixture. Raw payload не хранится.

`partner_revenue_observations` хранит canonical account/bindings/property, opaque `obs_…`, date, observed price/inventory/sales/revenue и optional operational facts. Повторное наблюдение с новым event ID обновляет authoritative night, сохраняя public observation ref; event ledger остаётся audit trail.

## KPI definitions

- Occupancy = `sum(soldInventory) / sum(availableInventory)`; `null`, если available = 0.
- ADR = `sum(realizedRoomRevenue) / sum(soldInventory)`; `null`, если sold = 0.
- RevPAR-equivalent = `sum(realizedRoomRevenue) / sum(availableInventory)`; `null`, если available = 0.
- Average booked rate совпадает с ADR для агрегированных room-night observations.
- Cancellation rate = cancellations / (bookingsCreated + cancellations) только для строк, где оба поля известны; `null` при отсутствии denominator.
- Average booking lead time — среднее только известных значений; иначе `null`.

Missing data никогда не превращается в вводящий в заблуждение zero.

## Shadow recommendation

Каждый элемент ответа содержит внешний `recommendationRef: prc_<32+ base64url chars>`, `stayDate`, observed `currentPrice`, `recommendedPrice`, `changeAmount`, `changePercent | null`, `confidence`, `confidenceBand`, strategy, reason codes, adjustment reasons, min/max guardrails и `mode: shadow`.

Тонкий ledger `partner_shadow_pricing_recommendations` ссылается на canonical observation и internal profile только внутри service-role boundary. Он не дублирует tariff grid и не меняет его. Ответ не раскрывает internal IDs.

## Confidence

Confidence — детерминированная оценка полноты данных, а не статистическая вероятность. Баллы дают: полный profile, свежие фактические signals и их confidence, inventory observation, booking pace/lead time и 14/30/90 nights history. Conflicting signals снижают score. Bands: low `< 0.45`, medium `0.45–0.7499`, high `>= 0.75`.

Любой source с `placeholder`, `synthetic` или `demo` исключается из production evidence и добавляет reason `synthetic_or_placeholder_signal_excluded`. Placeholder weather/events/market никогда не повышает partner confidence как реальный provider.

## Backtest и counterfactual safety

Bounded backtest отвечает только: «какую цену текущая логика ASI рекомендовала бы для наблюдавшейся ночи». По каждой eligible night сохраняются actual price, shadow price, delta, confidence и reasons; aggregates включают coverage, absolute/percentage delta directions, confidence distribution и observed occupancy/ADR/RevPAR.

Наблюдавшиеся метрики и shadow price difference разделены. `provenRevenueUplift` всегда `null`, status — `NOT_PROVEN`. Изменение цены могло изменить demand/occupancy, поэтому умножение shadow price на исторически sold nights не является доказательством дохода. Counterfactual revenue не наблюдался; v1 не публикует даже `NON-CAUSAL STATIC SCENARIO`.

Data sufficiency по eligible nights: `<14 insufficient`, `14–29 limited`, `30–89 usable`, `90+ strong`. Дополнительно перечисляются отсутствие occupied nights, lead-time coverage и price variation. Это operational thresholds, не научная гарантия.

## Pilot baseline и feedback

Server-only helpers выводят observation count, recommendation coverage, acceptance rate (accepted / accepted+rejected; ignored не в denominator), average confidence, high-confidence coverage, actual occupancy/ADR/RevPAR, average current price, average lead time, cancellation rate, average price delta и доли up/down/unchanged. Shadow response включает `pilotBaseline`, data sufficiency и explicit `NOT_PROVEN`; весь response сохраняется в idempotency event ledger, поэтому baseline является durable/sharable snapshot для указанного набора дат. Архитектура оставляет observed и recommendation cohorts раздельными для будущего controlled comparison.

Feedback append-only: каждое feedback event хранит recommendation, status, bounded reason и timestamp. Exact event replay не создаёт второй feedback. Feedback не меняет цену; актуальный outcome позднее определяется последним timestamp.

## SYNTHETIC DEMO DATA ONLY — Apartment 101

Fixture содержит 75 ночей с weekday/weekend, low/high-demand periods, изменяющейся ценой, occupancy, lead time, realized revenue, missing optional signals и отдельным synthetic event scenario. Это не данные Apart Sharing.

Демонстрационный Saturday scenario использует существующий `recommendPriceForDate`, профиль base 6,000 RUB / min 4,500 / max 6,500, weekend + summer + event pressure и затем реальный guardrail clamp:

- current upcoming Saturday: 6,000 RUB;
- ASI shadow recommendation: 6,500 RUB;
- reasons: weekend demand, seasonality, event signal, guardrail respected;
- confidence: high при полном profile, фактическом inventory/history и свежем non-placeholder input; placeholder event сам по себе confidence не повышает;
- historical sufficiency: usable (75 synthetic observations);
- observed occupancy: 74.65%; observed ADR: 5,315.09 RUB; observed RevPAR-equivalent: 3,967.61 RUB;
- 75-date shadow run coverage: 100%; average confidence: 0.7512; distribution: 70 high / 5 medium / 0 low при свежем internal signal, а synthetic/placeholder event исключён из confidence evidence;
- `PROVEN REVENUE UPLIFT: NOT AVAILABLE`.

Цифра 6,500 не является специальной целью алгоритма: это output существующей формулы с данным fixture и max guardrail.

## Данные от Apart Sharing

REQUIRED:

- stable external property identity, stay date, current rate, available inventory, sold inventory/booked state, currency;
- минимум 14 eligible nights для limited backtest; меньше допустимо для ingestion, но недостаточно для meaningful summary.

STRONGLY RECOMMENDED:

- realized room revenue, 30–89 nights history, booking creation date или lead time, bookings created/cancellations, min-stay/closed-to-arrival;
- preferred history: 90–365 nights, чтобы покрыть сезонность и получить `strong` по count от 90 nights.

OPTIONAL:

- фактически поставленные market/event/weather/supply signals с source/freshness/confidence;
- ideal: 12+ months для сезонного сравнения, но это не обязательный gate v1.

Competitor prices не нужны для первого backtest. External providers могут отсутствовать; система должна честно показать missing signals.

## Persistence и безопасность

Migration создаёт только `partner_revenue_events`, `partner_revenue_observations`, `partner_shadow_pricing_recommendations`, `partner_pricing_recommendation_feedback`. Все таблицы имеют tenant composite FKs, numeric/JSON/text checks, `ENABLE + FORCE RLS`, revoke для `anon/authenticated` и service-role-only grants. Migration не применяется persistently в рамках реализации.

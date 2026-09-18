# Positioning Map (v1)

Grounding material for `asi-website-editor`. Explains where ASI sits relative to manual operation, point automation, PMS/channel-manager suites, and separate AI assistants — and, separately, where the RU market specifically creates an opportunity or a wall. This document makes no unsupported competitor attacks: every negative statement about a named competitor is sourced to a specific finding in this research pass, and every gap is stated with a confidence level.

## The five reference points

### 1. Manual operation
No software. The operator (or staff) personally tracks bookings, answers guests, coordinates cleaning, and reconciles money, typically via messenger + memory + a spreadsheet. This is the baseline every other point improves on, and it is still the reality for many RU operators below the PMS-adoption threshold (market research: "WhatsApp/Telegram + a spreadsheet" for cleaning coordination in particular).

### 2. Point automation
A single tool automating a single function: a channel manager that syncs rates, a pricing tool that recommends a price, a lock-code app, a reputation-monitoring dashboard. Point tools are commodities in some categories (channel management is "effectively solved and commoditized" in the RU market — see below) and genuinely strong in others (Revkit's RU-native dynamic pricing; RentySoft's lock middleware). A point tool's defining limitation is not weakness at its one job — several are excellent at it — but that the *connections between* its output and the next operational step (does this price recommendation account for what the location module already knows about this address? does this cleaning-done event unlock check-in instructions automatically?) are the operator's job, not the tool's.

### 3. PMS / channel-manager suites
RU market leaders (RealtyCalendar, Bnovo, TravelLine, Контур.Отель) already bundle several point functions into one subscription — PMS + channel manager + CRM-lite + (for some) pricing, housekeeping tasks, and МВД filing. **This is the most important correction to the standard "fragmentation" narrative**: for the 10–30 unit apartment segment, RealtyCalendar in particular already covers PMS + channel manager + CRM + guest messaging + housekeeping coordination + payments/deposits + lock-code delivery in one subscription, at low per-unit pricing. Bnovo goes further (adds RMS/pricing and a genuine МВД module) but is reported as heavier/more expensive for apartment-scale operators. A positioning document that treats these as weak or absent would be factually wrong and would read as an uninformed attack.

Where these suites still fall short (confirmed gaps, not assumptions):
- **OTA payout/commission reconciliation** — no vendor surveyed appears to own this. Highest-confidence gap found in this entire research pass.
- **МВД e-filing inside posutochka-native (non-hotel-class) PMS** — Контур.Отель and Bnovo have it; RealtyCalendar's product pages did not show an explicit МВД-filing module (flagged as evidence-needed, not confirmed absent, in `PAIN_MAP.md` P5 — verify directly with the vendor before asserting this publicly).
- **Per-door lock economics** — locks are commonly a *separate* line item (RentySoft) even for operators using a bundled PMS, and are the single largest per-unit software cost found in the market.
- **Cleaner marketplace + coordination + QC specifically for apartments** (as opposed to hotels) — plausible gap, not exhaustively confirmed.

### 4. Separate AI/guest-communication assistants
International products in this category (Duve, Akia) and RU-native chatbot vendors (Хотбот, GuestBot, BotHelp's hotel vertical, lubava.ai) automate the conversation layer specifically. The RU-specific finding that changes this category's shape entirely: **Russia blocked WhatsApp nationwide on 2026-02-12** (Roskomnadzor DNS-level block; confirmed by CNBC, CNN, and The Moscow Times, among others, same date). Telegram is now the sole surviving major messenger for this use case, alongside **MAX**, the state-backed replacement app (preinstalled on new devices; business bot access requires a verified ИП/ООО profile; notably lacks end-to-end encryption and will share data with authorities on request per its own published position). Any guest-communication positioning written before this date, including ASI's own EN-site copy referencing broad "communication" automation without channel specificity, should be treated as needing a refresh to Telegram+MAX, never WhatsApp, for the RU market.

### 5. ASI's intended integrated operational runtime
ASI's own internal roadmap documents (`docs/platform-90-percent-roadmap.md`, `docs/blueprints/ASI-OPS-CONTOUR-BLUEPRINT.md`) describe the aspiration precisely: a `PlatformDecision` layer spanning location, pricing, communication, and ops, with an explicit priority policy for conflicts ("safety > payment > location upsell"), so that a human is escalated only for genuine exceptions rather than for routine hand-offs between otherwise-automated steps. **This is honestly rated 45–60% achievable by ASI's own internal readiness docs and is not yet built** — there is no shipped `PlatformDecision` schema.

What **is** real today, and is the actual evidence for this direction (not the aspiration, the evidence):
- Physical-readiness completion gates release of check-in instructions (`canReleaseCheckInInstructions`) — a real, tested cross-step dependency.
- Legal/deposit/МВД readiness gates the same check-in-instruction release — another real, tested cross-step dependency, independent of the first.
- Location/audience signals feed weighting factors in the pricing-recommendation engine — a real, if simple, cross-module data path.

These are narrow, specific, and genuinely stronger evidence of "connects the steps between functions" than a marketing slogan would be — but they do not yet add up to the general claim "ASI is one system that replaces N point tools by connecting them." That claim is the destination, not the current state. See `CLAIMS_REGISTER.md` for exact allowed wording at each level.

## Does the "point tools + a human in between" hypothesis hold?

The owner's hypothesis — that even where each point tool automates its own function well, a human remains in between multiple tools making decisions, moving information, and checking state — is **plausible and partially confirmed by this research, but not proven at the scale the hypothesis implies**:

- **Confirmed, narrowly:** RU market bundlers (RealtyCalendar, Bnovo) demonstrate that vendors themselves recognize the value of connecting functions — they bundle PMS + CM + CRM + (sometimes) pricing/cleaning/МВД precisely because operators don't want to be the integration layer between separate SaaS products. That a market response to this exact pain already exists is evidence the pain is real.
- **Not confirmed as "unsolved":** because RealtyCalendar/Bnovo already bundle several functions, the strongest form of the hypothesis ("every function is a separate tool with a human glue layer") **overstates the current RU market** for operators already on one of these platforms. The narrower, defensible version is: *even within a bundled suite, specific connective functions remain unbuilt* — payout reconciliation, cross-referencing pricing against location context, and gating check-in on multi-domain readiness (legal + physical) are not features of RealtyCalendar/Bnovo/TravelLine as far as this research found.
- **ASI's own advantage claim needs the same discipline applied to itself:** ASI's internal roadmap explicitly rates its own cross-module orchestration at less than two-thirds achievable and not yet built. ASI has real, narrow cross-module links (above) that RU point-tool bundlers were not found to have — that is a genuine, specific edge to claim. A general "ASI is the connected system, everyone else is fragmented" claim is not yet earned by either side's evidence and should not be published as-is.

**Recommended framing discipline:** lead with the specific, real, testable cross-module links ASI has today (readiness-gates-check-in, location-informs-pricing) rather than the general fragmentation narrative, and reserve the general "connects everything" claim for `FUTURE_ONLY` in `ROADMAP_PUBLIC_BOUNDARY.md`.

## International tools vs. the RU market: what the evidence actually shows

Do not write "no international competitor works in Russia." The evidence supports a narrower, more defensible claim:

> Every international STR/hospitality product examined (PriceLabs, Beyond, Hostaway, Guesty, OwnerRez, Hostfully, Duve, Akia, Operto, RemoteLock, Turno) connects to Airbnb/Booking.com/Vrbo/Expedia and bills through Stripe or an equivalent Western processor. None was found to connect to any RU OTA (Avito, Суточно.ру, Островок, Яндекс Путешествия). Airbnb suspended Russia/Belarus operations in March 2022 and Booking.com stopped bookings for Russian properties the same year; both remain suspended. Stripe's own documentation excludes Russia/Belarus from its supported countries. The practical result is that these tools are reachable on paper but structurally absent from the RU distribution and payment stack — not banned, just built for a different market that no longer overlaps with Russia's.

**One partial exception worth naming precisely, without overclaiming:** PriceLabs' own help documentation explicitly lists Russia as a supported country (one of only four named exclusions is Iran/North Korea/Cuba/Syria, and Russia is not among them) — but PriceLabs' direct OTA integrations are limited to Airbnb/Booking.com/Vrbo, so a Russian-located listing still has no functioning data-in/price-out path in practice. This is the precise, falsifiable version of "reachable on paper, unusable in practice" — do not simplify it to "PriceLabs doesn't work in Russia" (it is officially available) or to "PriceLabs works fine in Russia" (it has no usable RU integration path).

**Duve** is the other nuanced case: it genuinely supports Russian as a UI language (verified), but has no RU distribution/PMS integration and bills on Western rails — a real but practically inert capability.

**The real competitive set for RU positioning is Russian:** Bnovo, RealtyCalendar, TravelLine, Контур.Отель, Shelter, RST-TUR, plus the RU-native point tools named throughout this document (Revkit/Apartcab for pricing, RentySoft for locks, Wazzup/Chat2Desk for messaging aggregation, TL: Reputation/Getloyalty for reputation). A positioning document benchmarking ASI against Guesty instead of Bnovo is arguing with an opponent that isn't in the room.

## Возможности российского рынка

*(Раздел на русском языке — по требованию задачи, поскольку выводы должны напрямую использоваться при позиционировании для российского рынка. Каждый вывод — с уровнем уверенности и источником.)*

**Функции, для которых в РФ уже есть сильные решения:**
- Синхронизация каналов/OTA (channel management) — Bnovo, RealtyCalendar Channel Manager, TravelLine. Рынок называет этот слой «наиболее зрелым и наименее фрагментированным». **Уверенность: высокая** (данные вендоров).
- Динамическое ценообразование — Revkit (специализированный RU-продукт, интеграция с RealtyCalendar/TravelLine/Bnovo, прозрачные тарифы) и Apartcab. **Уверенность: высокая** для факта существования продукта; **неопределённость** по реальному уровню внедрения среди операторов (нет данных по проценту использования).
- Замки/доступ (техническая база) — TTLock/Tuya-экосистема плюс RU-мидлварь RentySoft (доставка кодов через Telegram/WhatsApp/MAX, интеграция с основными PMS). **Уверенность: высокая.**

**Функции, где решения фрагментированы:**
- CRM — нет доминирующего специализированного решения; рынок использует либо общий Bitrix24/amoCRM (адаптированный интеграторами под посуточную аренду), либо CRM-lite внутри PMS. **Уверенность: высокая.**
- Репутация/отзывы — реальная категория (TL: Reputation, Getloyalty и другие), но для оператора 10–30 объектов это «наиболее часто пропускаемая подписка» — обычно делается вручную через личные кабинеты площадок. **Уверенность: средняя.**

**Функции, где зарубежные лидеры плохо применимы в России:**
- Динамическое ценообразование (PriceLabs, Beyond) — формально доступны (PriceLabs прямо указывает Россию как поддерживаемую страну), но без интеграции с российскими OTA/PMS и без обычных платёжных рельсов (Stripe не работает в РФ) реального пути внедрения нет. **Уверенность: высокая** (данные вендоров + верифицированные ограничения Stripe).
- PMS/каналы (Hostaway, Guesty, OwnerRez, Hostfully) — та же структурная проблема: привязаны к Airbnb/Booking.com/Vrbo, которые не продают российский инвентарь с 2022 года. **Уверенность: средняя-высокая.**
- Умные замки (Operto, RemoteLock) и клининг-маркетплейсы (Turno) — привязаны к оборудованию и рабочей силе, которых физически нет на российском рынке в нужном виде; наименее переносимая категория. **Уверенность: средняя** (вывод основан на выводе об экосистеме, а не на прямом заявлении вендора).

**Функции, где рынок выглядит технологически отстающим:**
- Финансовая сверка выплат OTA (payout reconciliation) — не найдено ни одного российского продукта, решающего именно эту задачу, у операторов, использующих даже лучшие связки (RealtyCalendar, Bnovo). **Уверенность: средняя** (поиск не был исчерпывающим, но результат последователен по всем проверенным вендорам).
- МВД-подача внутри posutochka-ориентированных (не hotel-class) PMS — есть у Контур.Отель и Bnovo, не найдена явно у RealtyCalendar. **Уверенность: низкая-средняя** — требуется прямая проверка у вендора перед публичным заявлением.

**Функции, которые ASI потенциально может заменить:**
- Ничего однозначного не подтверждено на уровне «полной замены» — у ASI сейчас нет ни одной функции с доказанным уровнем LIVE_PROVEN, сопоставимым с зрелостью Bnovo/RealtyCalendar в их основных функциях (channel management, PMS). **Уверенность: высокая** (см. `CAPABILITY_INVENTORY.md`).
- Наиболее реалистичный кандидат — гостевые коммуникации (Telegram-слой ASI сейчас в статусе PILOT, что ближе к готовности, чем большинство остальных возможностей ASI), но и здесь RU-нативные чат-боты для гостиниц (Хотбot, GuestBot и другие) существуют и могут быть сопоставимы. **Уверенность: средняя.**

**Функции, где строить собственный аналог сейчас экономически бессмысленно:**
- Отдельный channel manager с нуля — рынок уже эффективно решил эту задачу за низкую цену (от ~75–260 ₽/объект/день у RealtyCalendar). Дублирование этой функции без явного интеграционного преимущества не создаёт ценности. **Уверенность: высокая.**

**Функции, где интеграция ASI создаёт преимущество даже при наличии хорошего отдельного сервиса:**
- Ценообразование, дополненное контекстом объекта/локации (а не только конкурентным анализом) — у ASI уже есть реальный (протестированный) код, связывающий локационные/аудиторные сигналы с весами в pricing-движке; Revkit, судя по найденным данным, не заявляет о таком контексте. **Уверенность: средняя** — связь реальна в коде ASI, но её качество/точность не подтверждена независимо.
- Гейтинг check-in-инструкций одновременно по физической готовности (уборка) и юридической готовности (МВД/депозит/договор) в одном решении — не найдено явного аналога у RealtyCalendar/Bnovo, которые обычно решают эти два блока раздельно. **Уверенность: средняя.**

**Важная оговорка:** если российский конкурент делает какую-либо функцию лучше ASI сейчас — это прямо отражено выше (например, автоматическая отправка клинеру и ротация кода замка через бота у RealtyCalendar Автопилот — реальная возможность, которой у ASI пока нет; см. `PAIN_MAP.md` P13). Цель этого документа — не подогнать вывод под желаемый ответ, а показать, где у ASI действительно есть основание для преимущества и что именно стоит строить дальше.

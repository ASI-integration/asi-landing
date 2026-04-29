# RU location-analysis demo — validation pack (manual QA)

This document is for **manual validation** of the `/ru/location-analysis` demo UI and end-to-end behavior.
It is **not** an acceptance test suite and **must not** be used to tune scoring, weights, or canonical rules.

For each case below:
- Enter the address (or pick it from suggestions when available)
- Run the demo analysis
- Confirm the UI renders a result card, headings, and detail blocks without layout overflow
- Confirm the **audience archetype** is reasonable for the address context
- Confirm nothing obviously nonsensical happens (e.g. “business” audience for a pure resort area)

## Cases

### 1. СПб, Комендантский пр., 23к1
- archetype: residential district center
- expected score band: moderate
- expected audience: residential
- what should NOT happen: tourist/business audience dominating
- smoke-test notes: result card fits above the fold on desktop; “Почему такой балл?” shows 1–2 reasons

### 2. СПб, Московская ул., 12
- archetype: peripheral residential street
- expected score band: weak
- expected audience: residential
- what should NOT happen: “strong” band with tourist audience
- smoke-test notes: “Как рассчитана оценка” section is present and readable

### 3. СПб, Невский пр., 28
- archetype: prime tourist high street
- expected score band: strong
- expected audience: tourist
- what should NOT happen: residential-only audience
- smoke-test notes: check competitor / market environment blocks render without broken headings

### 4. СПб, Московский пр., 97
- archetype: mixed urban avenue
- expected score band: moderate
- expected audience: mixed
- what should NOT happen: resort audience
- smoke-test notes: “Рыночное окружение” comes before the trust block (“Не просто сравнение с соседями”)

### 5. Москва, Тверская ул., 7
- archetype: prime tourist high street
- expected score band: strong
- expected audience: tourist
- what should NOT happen: weak band
- smoke-test notes: verify the main card uses a horizontal dashboard layout on desktop

### 6. Москва, Пресненская наб., 12
- archetype: business district (CBD)
- expected score band: strong
- expected audience: business
- what should NOT happen: resort audience
- smoke-test notes: verdict block and CTA are visible without scrolling on 1280×800

### 7. Москва, ВДНХ, пр-т Мира, 119
- archetype: major attraction / tourist cluster
- expected score band: strong
- expected audience: tourist
- what should NOT happen: purely residential audience
- smoke-test notes: check “Конкурентная среда” renders with a real heading (not tiny uppercase)

### 8. Казань, Баумана, 21
- archetype: tourist pedestrian street
- expected score band: strong
- expected audience: tourist
- what should NOT happen: weak band
- smoke-test notes: confirm no internal label like “Нагрузка среды” appears

### 9. Казань, Ямашева, 46
- archetype: mixed urban corridor
- expected score band: moderate
- expected audience: mixed
- what should NOT happen: resort audience
- smoke-test notes: verify “Среда вокруг объекта” section exists and reads naturally

### 10. Сочи, Курортный пр., 50
- archetype: prime resort corridor
- expected score band: strong
- expected audience: resort
- what should NOT happen: business-only audience
- smoke-test notes: check the surroundings status chip reads market-facing (e.g. “Окружение: …”)

### 11. Сочи, Адлер, Ленина, 219
- archetype: resort / mixed tourist area
- expected score band: moderate
- expected audience: resort
- what should NOT happen: residential-only audience
- smoke-test notes: verify long explanatory paragraphs don’t push CTA far below the fold

### 12. Анапа, Пионерский пр., 20
- archetype: resort strip
- expected score band: moderate
- expected audience: resort
- what should NOT happen: tourist audience labeled as business
- smoke-test notes: ensure the result page doesn’t get stuck in loading / timeout fallback

### 13. Геленджик, Революционная, 29
- archetype: resort town center
- expected score band: moderate
- expected audience: resort
- what should NOT happen: strong business audience
- smoke-test notes: verify headings hierarchy feels consistent across sections

### 14. Калининград, Ленинский пр., 30
- archetype: tourist / central avenue
- expected score band: moderate
- expected audience: tourist
- what should NOT happen: resort archetype
- smoke-test notes: check “Состав индекса” block is present and readable (15–16px body)

### 15. Екатеринбург, Малышева, 51
- archetype: business / central commercial corridor
- expected score band: strong
- expected audience: business
- what should NOT happen: resort audience
- smoke-test notes: verify competitor block renders and doesn’t overflow

### 16. Новосибирск, Красный пр., 50
- archetype: mixed central corridor
- expected score band: moderate
- expected audience: mixed
- what should NOT happen: weak residential-only classification for a central avenue
- smoke-test notes: check CTA block appears after the content and is not duplicated

### 17. Н.Новгород, Б. Покровская, 20
- archetype: prime tourist street
- expected score band: strong
- expected audience: tourist
- what should NOT happen: weak band
- smoke-test notes: verify map / external map link works and doesn’t break layout

### 18. Всеволожск, Колтушское ш., 44
- archetype: suburban residential
- expected score band: weak
- expected audience: residential
- what should NOT happen: tourist audience
- smoke-test notes: ensure “Почему такой балл?” still shows meaningful factors even for weak locations

### 19. Горелово, Красносельское ш., 50
- archetype: suburban / peripheral residential
- expected score band: weak
- expected audience: residential
- what should NOT happen: resort audience
- smoke-test notes: check that the result card stays compact (no long paragraphs inside it)

### 20. Шерегеш, Гагарина, 12
- archetype: resort / ski area
- expected score band: moderate
- expected audience: resort
- what should NOT happen: business audience dominating
- smoke-test notes: verify the “Окружение” labeling is consistent and user-facing

---

This file is for manual validation planning. Scoring logic and canonical rules must not be tuned to satisfy these expectations.


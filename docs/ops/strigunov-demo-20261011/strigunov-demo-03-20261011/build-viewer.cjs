// Task03: read verified historical fixture bytes; emit local read-only presentation.
// Run only after independent exact-source review. No network, DB, subprocess or env access.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname;
const INPUT = path.resolve(ROOT, '../task02-evidence-20261011');
const SHA = 'f42cd99f57bafa681def155a676619a1d80504fe';
const expected = {
  'timeline.json': 'd5e330e401468cd978a3b363f285ee35e227e477ada3706dbfaea8a4f833e6c3',
  'test-results.json': 'dc0e4401e62a676a6fde74c55225424ddcf8d5d7c8379cbec9ecce4b704c47ef',
};
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ensure = (condition, reason) => { if (!condition) throw Error(reason); };
const files = Object.fromEntries(Object.entries(expected).map(([name, digest]) => {
  const bytes = fs.readFileSync(path.join(INPUT, name));
  ensure(hash(bytes) === digest, 'source_hash_mismatch:' + name);
  return [name, bytes];
}));
const data = JSON.parse(files['timeline.json']);
const results = JSON.parse(files['test-results.json']);
ensure(data.synthetic === true && data.externalIntegration === 'not_integrated', 'not_synthetic');
ensure(data.timeline.length === 14 && data.replies.length === 1, 'unexpected_counts');
ensure(results.success && results.numTotalTests === 18 && results.numPassedTests === 18 && results.numFailedTests === 0, 'tests_not_passed');
const scope = {
  accountId: 'synthetic-strigunov-account', bookingId: '11111111-1111-4111-8111-111111111111',
  propertyId: 'synthetic-strigunov-apartment', requestId: 'synthetic-early-arrival-1200',
};
const sameScope = value => Object.keys(scope).every(k => value[k] === scope[k]);
ensure(sameScope(data.scope) && sameScope(data.replies[0].scope), 'reply_scope_mismatch');
let previous = -Infinity;
const ids = new Set();
for (const event of data.timeline) {
  ensure(sameScope(event.scope) && event.taskId === 'synthetic-cleaning-task-1', 'event_scope_mismatch');
  ensure(!ids.has(event.id), 'duplicate_event_id'); ids.add(event.id);
  const at = Date.parse(event.at); ensure(Number.isFinite(at) && at >= previous, 'event_time_invalid'); previous = at;
  ensure(event.actor.startsWith('synthetic-') && event.evidence.startsWith('synthetic-'), 'event_provenance_invalid');
}
ensure(data.replies[0].decisionId === data.decision.id && data.decision.approved === true, 'decision_mismatch');
const label = {
  guest_request_and_policy: 'Гость просит ранний заезд',
  operator_handoff_and_assignment: 'Запрос передан ответственному',
  guest_response_held: 'Подтверждение пока запрещено',
  operator_acknowledged: 'Оператор принял запрос',
  cleaning_assigned: 'Уборка назначена',
  cleaning_in_progress: 'Уборка началась',
  cleaning_completed: 'Уборка завершена — нужна проверка',
  cleaning_verified: 'Оператор проверил уборку',
  readiness_observed: 'Получено свежее наблюдение',
  operator_approved: 'Оператор разрешил ранний заезд',
  readiness_rechecked_before_reply: 'Готовность проверена ещё раз',
  synthetic_reply_recorded: 'Один ответ записан в тестовый приёмник',
  duplicate_reply_suppressed: 'Повторный ответ подавлен',
};
const role = {'synthetic-guest':'Гость · имитация','synthetic-system':'ASI · тестовый сценарий',
  'synthetic-operator-1':'Оператор · имитация','synthetic-cleaner-1':'Исполнитель уборки · имитация'};
const state = {pending:'Ожидание',hold:'Подтверждать нельзя',approved:'Разрешено в сценарии'};
const time = at => new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(new Date(at));
const cards = data.timeline.map((event,i) => {
  ensure(label[event.kind] && role[event.actor] && state[event.outcome], 'unknown_event_presentation');
  return `<li class="event ${esc(event.outcome)}" data-event-id="${esc(event.id)}" data-event-kind="${esc(event.kind)}">
  <div class="event-top"><span class="step">Шаг ${i+1} / 14</span><time datetime="${esc(event.at)}">${esc(time(event.at))} МСК</time></div>
  <h3>${esc(label[event.kind])}</h3>
  <p class="role">${esc(role[event.actor])}</p>
  <p class="detail">${esc(event.detail)}</p>
  <span class="badge">${esc(state[event.outcome])}</span>
  <details><summary>Исходная запись и доказательство</summary>
  <pre class="raw">${esc(JSON.stringify(event,null,2))}</pre></details></li>`;
}).join('\n');
const caseLabels = [
'Полный сценарий и единый журнал','12:00 требует отдельного подтверждения','Завершённая уборка ещё не проверена',
'Готовность неизвестна','Готовность устарела до ответа','Будущее или неверное время наблюдения',
'Чужой аккаунт','Нет решения оператора','Документы не разрешают заселение','Предыдущий гость ещё не выехал',
'Повтор запроса или действия','Один номер действия с разными данными','Новый блокер после разрешения',
'Оператор отказал','Исполнитель сообщил о препятствии','Неверный участник или порядок уборки',
'Оператор ещё не принял запрос','Попытка изменить копию результата или время',
];
const assertions = results.testResults.flatMap(f => f.assertionResults);
ensure(assertions.length === 18, 'assertion_count_mismatch');
const cases = assertions.map((test,i) => {
  ensure(test.status === 'passed' && test.title.startsWith(String(i+1).padStart(2,'0')+' '), 'test_order_mismatch');
  return `<li class="case" data-case-number="${i+1}"><span class="check">PASS</span><div><strong>${esc(caseLabels[i])}</strong>
  <details><summary>Название фактической проверки</summary><p class="raw">${esc(test.fullName)}</p></details></div></li>`;
}).join('\n');
const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<title>ASI — ранний заезд в 12:00 · синтетическое демо</title>
<style>
:root{color-scheme:light;--ink:#182f34;--muted:#4b6469;--line:#c6d6d4;--paper:#f4f7f3;--teal:#096657;--amber:#805313}
*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;background:var(--paper);color:var(--ink);font:19px/1.55 "Segoe UI",Arial,sans-serif}
header{background:#153a3b;color:white;padding:16px 5vw}.brand{font-weight:800;letter-spacing:.12em;font-size:23px}.banner{background:#ffe2a6;color:#422900;padding:13px 5vw;font-weight:800;line-height:1.4}
main{max-width:1160px;margin:auto;padding:32px 28px 70px}h1{font-size:clamp(32px,4.5vw,52px);line-height:1.12;letter-spacing:-.035em;max-width:860px;margin:15px 0 20px}h2{font-size:30px;line-height:1.2;margin:0 0 16px}h3{font-size:23px;line-height:1.3;margin:12px 0 8px}p{margin:8px 0 16px}.eyebrow{font-size:15px;font-weight:800;letter-spacing:.09em;color:var(--teal)}
.lead{max-width:880px;color:var(--muted);font-size:21px}nav{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0 32px}a{color:#065c73;text-underline-offset:4px;overflow-wrap:anywhere}nav a{padding:10px 17px;border:1px solid var(--line);border-radius:8px;background:white;text-decoration:none;font-weight:650}
a:focus-visible,summary:focus-visible{outline:3px solid #087ea4;outline-offset:4px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.stat{padding:19px;border:1px solid var(--line);border-radius:12px;background:white}.stat strong{display:block;font-size:35px;line-height:1.2}.stat span{color:var(--muted);font-size:16px}
section{margin-top:42px;scroll-margin-top:20px}.note{border-left:5px solid var(--amber);background:#fff3da;padding:18px 22px;border-radius:0 12px 12px 0}.gate-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}.panel{background:white;border:1px solid var(--line);border-radius:12px;padding:22px}.panel h3{margin-top:0}.small{font-size:16px;color:var(--muted)}
.timeline{list-style:none;padding:0;margin:24px 0;display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.event{background:white;border:1px solid var(--line);border-top:5px solid #799da1;border-radius:12px;padding:22px;min-width:0}.event.hold{border-top-color:#ae741d}.event.approved{border-top-color:var(--teal)}.event-top{display:flex;justify-content:space-between;gap:12px;font-size:15px;font-weight:700;color:var(--muted)}.role{font-size:16px;color:var(--muted)}.detail{font-size:18px;overflow-wrap:anywhere}.badge{display:inline-block;padding:4px 10px;background:#e8eff0;border-radius:6px;font-size:14px;font-weight:750}.hold .badge{background:#fff0d0;color:#684207}.approved .badge{background:#def0e6;color:#105542}
details{margin-top:16px}summary{cursor:pointer;font-size:16px;color:#075e72;font-weight:650}.raw,code{font:14px/1.55 Consolas,monospace;overflow-wrap:anywhere;white-space:pre-wrap}.raw{background:#eef3f2;padding:14px;border-radius:7px}.cases{list-style:none;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:12px}.case{display:flex;gap:14px;background:white;border:1px solid var(--line);border-radius:10px;padding:17px}.case strong{font-size:17px}.check{font-size:13px;font-weight:800;color:#105542;padding-top:4px}.hash{display:block;margin:12px 0;background:#e7efed;padding:14px;border-radius:7px}.links{display:flex;gap:20px;flex-wrap:wrap}.limits li{margin-bottom:10px}footer{margin-top:38px;padding-top:22px;border-top:1px solid var(--line);color:var(--muted);font-size:16px}
@media(max-width:700px){main{padding:24px 18px 45px}.timeline,.cases,.gate-grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.event{padding:18px}h2{font-size:27px}nav a{font-size:16px}.lead{font-size:19px}.banner{font-size:15px}}
@media print{body{font-size:13px}main{padding:10px}.timeline{grid-template-columns:1fr}.event{break-inside:avoid}nav,details{display:none}}
</style></head><body>
<header><span class="brand">ASI</span> <span> / Booking Ops · просмотр результата</span></header>
<div class="banner" role="note">СИНТЕТИЧЕСКОЕ ДЕМО — НЕ PRODUCTION</div>
<main><p class="eyebrow">СТРИГУНОВ · ОДНА БРОНЬ · ОДНА КВАРТИРА</p>
<h1>Ранний заезд: от запроса в 12:00 до безопасного ответа</h1>
<p class="lead">Гость хочет заехать раньше. ASI проверяет правила, ждёт готовности квартиры и решения оператора — затем записывает один ответ в тестовый приёмник.</p>
<p class="small">Сохранённый результат проверки 11 октября 2026 года. Это историческая запись: страница не запускает работу и не показывает живой прогресс.</p>
<nav aria-label="Разделы"><a href="#timeline">14 событий</a><a href="#negative">Когда нельзя подтверждать</a><a href="#evidence">Доказательства</a><a href="#limits">Границы демо</a></nav>
<div class="stats"><div class="stat"><strong>1</strong><span>синтетическая бронь</span></div><div class="stat"><strong>14</strong><span>событий в журнале</span></div><div class="stat"><strong>18 / 18</strong><span>ранее пройденных тестов</span></div><div class="stat"><strong>1</strong><span>ответ в fake sink</span></div></div>
<section aria-labelledby="gates-title"><h2 id="gates-title">Разрешение — ещё не отправка</h2>
<div class="note">В 11:48 оператор разрешил ранний заезд. Ответ появился только в 11:49, после повторной проверки. Реальных сообщений гостям: <strong>0</strong>.</div>
<div class="gate-grid"><div class="panel"><h3>Квартира действительно готова?</h3><p>В сценарии проверены уборка, бельё, расходники, отсутствие блокирующего ремонта и предыдущий выезд.</p><p class="small">Это синтетические входы Task02. «Уборка завершена» не означает «уборка проверена».</p></div>
<div class="panel"><h3>Документы и решение человека</h3><p>Проверяется правовой допуск и решение оператора для этой брони. При запрете подтверждение не записывается.</p><p class="small">Ручной legal fixture, без реальных документов и подписи. В журнале нет исходного документа. Оки-Доки не подключён.</p></div></div></section>
<section id="timeline"><p class="eyebrow">СИНТЕТИЧЕСКАЯ ХРОНОЛОГИЯ · НЕ ЖИВОЙ СТАТУС</p><h2>Что произошло по шагам</h2><p>Время сценария — московское. Каждая карточка соответствует одной исходной записи; её можно раскрыть.</p><ol class="timeline">${cards}</ol></section>
<section id="negative"><p class="eyebrow">ПРОВЕРКИ TASK02 · НЕ ДОПОЛНИТЕЛЬНЫЕ СОБЫТИЯ</p><h2>Когда ASI должна остановиться</h2><p>Ниже — фактические результаты ранее выполненных тестов. Отдельных журналов отрицательных сценариев в evidence нет; дополнительные события здесь не придуманы.</p>
<div class="note"><strong>Смена политики заезда: НЕ ПРОВЕРЕНА.</strong> Правило 12:00 фиксировано для этой версии. Тест устаревшей готовности не доказывает отзыв разрешения после изменения самой политики.</div><ul class="cases">${cases}</ul></section>
<section id="evidence"><p class="eyebrow">ПРОВЕРЯЕМЫЙ ИСТОЧНИК</p><h2>Доказательства и версия</h2>
<p>Хронология загружена при сборке из сохранённого Task02 JSON. Копия ниже побайтово совпадает с исходником. Страница ничего не запрашивает из сети.</p>
<p class="links"><a href="./timeline.json">14 исходных событий · JSON</a><a href="./test-results.json">18 результатов тестов · JSON</a><a href="./evidence-manifest.json">Файлы и контрольные суммы</a></p>
<p>SHA256 исходной хронологии:</p><code class="hash">${expected['timeline.json']}</code>
<p>Базовый commit:</p><code class="hash">${SHA}</code>
<details><summary>Идентификаторы синтетической брони</summary><pre class="raw">${esc(JSON.stringify(scope,null,2))}</pre></details>
<p class="small">Task02 и этот viewer ещё не опубликованы в Git. Commit выше обозначает исходную версию, а не наличие новых файлов в GitHub.</p></section>
<section id="limits"><p class="eyebrow">ГРАНИЦЫ СИНТЕТИЧЕСКОГО ДЕМО</p><h2>Что этот показ не доказывает</h2>
<ul class="limits"><li>Готовность production-пилота: privacy-релиз, доступ владельца, CRM и надёжная отправка требуют отдельной приёмки.</li><li>Реальную личность оператора, состояние квартиры и юридическую подпись.</li><li>Дедупликацию между worker-процессами или восстановление после рестарта: здесь память одного fixture.</li><li>Интеграции RentHouse / CleanControl / Оки-Доки: они <strong>не подключены</strong>.</li><li>Отзыв разрешения при изменении политики заезда: этот вход не моделируется.</li></ul></section>
<footer>ASI · синтетический показ автоматизации поверх внешней системы. Без подключения внешней системы, реальных данных и отправок.</footer>
</main></body></html>`;
for (const name of ['index.html','timeline.json','test-results.json','evidence-manifest.json']) ensure(!fs.existsSync(path.join(ROOT,name)), 'output_exists:' + name);
for (const [name,bytes] of Object.entries(files)) fs.writeFileSync(path.join(ROOT,name),bytes,{flag:'wx'});
fs.writeFileSync(path.join(ROOT,'index.html'),html,{flag:'wx'});
const manifest = {
  synthetic:true, mode:'historical-read-only', sourceCommit:SHA, externalIntegration:'not_integrated',
  files:Object.fromEntries(['index.html','timeline.json','test-results.json','build-viewer.cjs'].map(name => {
    const bytes=fs.readFileSync(path.join(ROOT,name));return[name,{bytes:bytes.length,sha256:hash(bytes)}];
  })),
  events:14, task02Tests:{passed:18,total:18,rerun:false}, scope,
  limitations:['policy_change_not_modeled','in_memory_dedup_only','no_real_messages','no_external_integration','not_production_readiness'],
};
fs.writeFileSync(path.join(ROOT,'evidence-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(manifest,null,2));

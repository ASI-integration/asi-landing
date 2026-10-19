// Positive allow-list: this script only. No Task02 tests, app imports, or web server.
// Read-only browser render of index.html in a fresh, isolated offline profile.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/asi-landing/node_modules/playwright');
const ROOT = __dirname;
const OUT = path.join(ROOT,'render-evidence');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  assert.equal(fs.existsSync(OUT),false,'refuse to reuse browser profile/results');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT,'evidence-manifest.json'),'utf8'));
  for(const [name,expected] of Object.entries(manifest.files)) {
    assert.equal(path.basename(name),name,'only local artifact basenames allowed');
    const bytes=fs.readFileSync(path.join(ROOT,name));
    assert.equal(bytes.length,expected.bytes);assert.equal(hash(bytes),expected.sha256);
  }
  const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const timeline = JSON.parse(fs.readFileSync(path.join(ROOT,'timeline.json'),'utf8'));
  const tests = JSON.parse(fs.readFileSync(path.join(ROOT,'test-results.json'),'utf8'));
  assert.ok(!/<script\b|<iframe\b|<form\b|<img\b|<link\b|\bon[a-z]+\s*=/i.test(html),'no active/external HTML');
  assert.ok(html.includes("script-src 'none'")&&html.includes("connect-src 'none'"));
  fs.mkdirSync(OUT);
  const results = [];
  const requests = [];
  const pageErrors = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(OUT,'browser-profile'),{
      headless:true,chromiumSandbox:true,offline:true,javaScriptEnabled:false,
      serviceWorkers:'block',acceptDownloads:false,viewport:{width:1440,height:1000},
      locale:'ru-RU',timezoneId:'Europe/Moscow',
    });
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(!url.startsWith('file:')){requests.push(url);return route.abort();}
      return route.continue();
    });
    const page = context.pages()[0] || await context.newPage();
    page.on('pageerror',e=>pageErrors.push(e.message));
    page.on('request',r=>{if(!r.url().startsWith('file:'))requests.push(r.url());});
    await page.goto(pathToFileURL(path.join(ROOT,'index.html')).href,{waitUntil:'load'});
    async function check(name,fn){await fn();results.push({name,status:'PASS'});}
    await check('01 verified artifact bytes before render',async()=>assert.equal(manifest.events,14));
    await check('02 synthetic banner and historical status visible',async()=>{
      assert.match(await page.locator('.banner').innerText(),/СИНТЕТИЧЕСКОЕ ДЕМО — НЕ PRODUCTION/);
      assert.match(await page.locator('main').innerText(),/историческая запись/);
    });
    await check('03 every card is exact corresponding event JSON',async()=>{
      assert.equal(await page.locator('.event').count(),14);
      for(let i=0;i<14;i++){
        const card=page.locator('.event').nth(i);
        assert.equal(await card.getAttribute('data-event-id'),timeline.timeline[i].id);
        assert.equal(await card.getAttribute('data-event-kind'),timeline.timeline[i].kind);
        assert.equal(await card.locator('.detail').innerText(),timeline.timeline[i].detail);
        assert.deepEqual(JSON.parse(await card.locator('pre.raw').textContent()),timeline.timeline[i]);
        assert.equal(await card.locator('time').getAttribute('datetime'),timeline.timeline[i].at);
      }
    });
    await check('04 one identity and one reply remain bound to approval',async()=>{
      for(const e of timeline.timeline){assert.deepEqual(e.scope,timeline.scope);assert.equal(e.taskId,timeline.task.id);}
      assert.equal(timeline.replies.length,1);
      assert.equal(timeline.replies[0].decisionId,timeline.decision.id);
      assert.ok(timeline.timeline.findIndex(e=>e.kind==='operator_approved') <
        timeline.timeline.findIndex(e=>e.kind==='synthetic_reply_recorded'));
      assert.equal(await page.locator('[data-event-kind="synthetic_reply_recorded"]').count(),1);
    });
    await check('05 18 historical cases faithfully labeled and not extra events',async()=>{
      const cases=tests.testResults.flatMap(f=>f.assertionResults);
      assert.equal(await page.locator('.case').count(),18);
      for(let i=0;i<18;i++){
        assert.equal(cases[i].status,'passed');
        assert.equal(await page.locator('.case').nth(i).locator('.raw').textContent(),cases[i].fullName);
      }
      assert.match(await page.locator('#negative').innerText(),/не придуманы/);
    });
    await check('06 policy change and live integration limitations remain visible',async()=>{
      assert.match(await page.locator('#negative').innerText(),/Смена политики заезда: НЕ ПРОВЕРЕНА/);
      assert.match(await page.locator('#limits').innerText(),/не подключены/);
      assert.match(await page.locator('#limits').innerText(),/восстановление после рестарта/);
    });
    await check('07 evidence links stay local and source hash matches',async()=>{
      const hrefs=await page.locator('a').evaluateAll(links=>links.map(a=>a.getAttribute('href')));
      for(const href of hrefs)assert.ok(href.startsWith('#')||['./timeline.json','./test-results.json','./evidence-manifest.json'].includes(href));
      assert.ok(await page.locator('#evidence').innerText().then(t=>t.includes(manifest.files['timeline.json'].sha256)));
    });
    await check('08 desktop layout has no horizontal overflow',async()=>{
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(OUT,'desktop.png'),fullPage:true});
    });
    await check('09 native details expose exact evidence without page JavaScript',async()=>{
      const details=page.locator('.event').first().locator('details');
      await details.locator('summary').click();
      assert.equal(await details.getAttribute('open'),'');
      assert.deepEqual(JSON.parse(await details.locator('pre').innerText()),timeline.timeline[0]);
      await details.locator('summary').click();
    });
    await check('10 mobile layout and anchor navigation remain usable',async()=>{
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.locator('nav a[href="#negative"]').click();
      assert.match(page.url(),/#negative$/);
      await page.locator('h1').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(OUT,'mobile.png'),fullPage:true});
    });
    await check('11 no active controls or page scripts',async()=>{
      assert.equal(await page.locator('script,iframe,form,input,button').count(),0);
      assert.equal(pageErrors.length,0);
    });
    await check('12 zero external page requests and unchanged artifact hashes',async()=>{
      assert.deepEqual(requests,[]);
      for(const [name,expected] of Object.entries(manifest.files))
        assert.equal(hash(fs.readFileSync(path.join(ROOT,name))),expected.sha256);
    });
  } catch(error) {
    results.push({name:'execution',status:'FAIL',message:error.message});
    process.exitCode=1;
  } finally {
    if(context)await context.close();
    const result={scope:'Task03/04 presentation only; Task02 not rerun',passed:results.filter(r=>r.status==='PASS').length,
      failed:results.filter(r=>r.status==='FAIL').length,results,externalPageRequests:requests,pageErrors,
      sourceHtmlSha256:hash(fs.readFileSync(path.join(ROOT,'index.html'))),checkerSha256:hash(fs.readFileSync(__filename))};
    fs.writeFileSync(path.join(OUT,'render-results.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(result,null,2));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeUrl,
  shouldCrawlHref,
  isSameOrigin,
  hashTargetExists,
  classifyLinkFailure,
  isGoogleSearchOrRedirect,
} from '../url-policy.mjs';
import {
  detectCommercialConflicts,
  detectPatternFindings,
  runRuleEngine,
  sortFindings,
  analyzeLinks,
} from '../rule-engine.mjs';
import {
  UNSUPPORTED_CLAIM_PATTERNS,
  OBSOLETE_JARGON_PATTERNS,
  SENSITIVE_PATTERNS,
  maskSensitive,
} from '../contracts/ru-public-site.mjs';
import { cleanVisibleText, toCorpusRecord } from '../page-extractor.mjs';
import { resolveExitCode } from '../report.mjs';

const BASE = 'https://asi-global.ru/ru';

test('normalizeUrl strips hash and trailing slash', () => {
  assert.equal(
    normalizeUrl('https://asi-global.ru/ru/offer/#section', BASE),
    'https://asi-global.ru/ru/offer',
  );
  assert.equal(normalizeUrl('https://asi-global.ru/ru/', BASE), 'https://asi-global.ru/ru');
});

test('same-origin policy and skip list', () => {
  assert.equal(isSameOrigin('/ru/privacy', BASE), true);
  assert.equal(shouldCrawlHref('mailto:support@asi-global.ru', BASE).crawl, false);
  assert.equal(shouldCrawlHref('https://t.me/ASI_Support_Bot', BASE).crawl, false);
  assert.equal(shouldCrawlHref('/api/early-access/objects', BASE).crawl, false);
  assert.equal(shouldCrawlHref('/dashboard/settings', BASE).crawl, false);
  assert.equal(shouldCrawlHref('/ru/offer', BASE).crawl, true);
  assert.equal(shouldCrawlHref('#pilot-form', BASE).crawl, false);
});

test('fragment target validation', () => {
  assert.equal(hashTargetExists('#pilot-form', ['pilot-form', 'pricing']), true);
  assert.equal(hashTargetExists('#missing', ['pilot-form']), false);
});

test('broken-link classification', () => {
  assert.equal(classifyLinkFailure(404)?.severity, 'critical');
  assert.equal(classifyLinkFailure(500)?.severity, 'critical');
  assert.equal(classifyLinkFailure(200), null);
  assert.equal(classifyLinkFailure(null)?.severity, 'critical');
});

test('google search URLs flagged', () => {
  assert.equal(isGoogleSearchOrRedirect('https://www.google.com/search?q=asi', BASE), true);
});

test('commercial contract: correct 0/14/1000 flow passes', () => {
  const text =
    'Подключение и настройка — 0 ₽. 14 дней работы на объекте — 0 ₽. После пилота — 1000 ₽ / объект в месяц. Никаких автоматических продлений.';
  const findings = detectCommercialConflicts(text, '/ru');
  assert.equal(findings.length, 0);
});

test('commercial contract: paid pilot conflict fails', () => {
  const findings = detectCommercialConflicts('Платный пилот доступен сразу после заявки.', '/ru/x');
  assert.ok(findings.some((f) => f.id === 'COMMERCIAL_PAID_PILOT_CONFLICT'));
});

test('commercial contract: wrong monthly price fails', () => {
  const findings = detectCommercialConflicts('После пилота — 2500 ₽ / объект в месяц.', '/ru/x');
  assert.ok(findings.some((f) => f.id === 'COMMERCIAL_CONTINUATION_PRICE_CONFLICT'));
});

test('commercial contract: auto-renewal claim fails', () => {
  const findings = detectCommercialConflicts(
    'После пилота подписка автоматически продлевается.',
    '/ru/x',
  );
  assert.ok(findings.some((f) => f.id === 'COMMERCIAL_AUTO_PAID_TRANSITION'));
});

test('unsupported claim patterns', () => {
  const findings = detectPatternFindings(
    'ASI обеспечивает полную автоматизацию без человека.',
    '/ru',
    UNSUPPORTED_CLAIM_PATTERNS,
    'unsupported-claim',
  );
  assert.ok(findings.some((f) => f.id === 'CLAIM_FULL_AUTOMATION'));
  assert.ok(findings.some((f) => f.id === 'CLAIM_WITHOUT_HUMAN'));
  assert.ok(findings.every((f) => f.explanation.includes('requires runtime confirmation')));
});

test('jargon/obsolete phrase detection', () => {
  const findings = detectPatternFindings(
    'Мы строим операционный слой поверх менеджера каналов.',
    '/ru',
    OBSOLETE_JARGON_PATTERNS,
    'jargon',
  );
  assert.ok(findings.some((f) => f.id === 'JARGON_OPERATIONAL_LAYER'));
});

test('sensitive value masking', () => {
  assert.equal(maskSensitive('SecretPass99'), 'Se…99');
  const findings = detectPatternFindings(
    'Wi-Fi пароль: SuperSecret99',
    '/ru',
    SENSITIVE_PATTERNS,
    'sensitive',
  );
  assert.ok(findings.some((f) => f.id === 'SENSITIVE_WIFI_PASSWORD'));
  assert.ok(!findings[0].evidence.includes('SuperSecret99'));
  assert.match(findings[0].evidence, /…/);
});

test('deterministic ordering of findings', () => {
  const unsorted = [
    { id: 'B', severity: 'minor', url: '/b', category: 'x', title: '', evidence: '', explanation: '', action: '' },
    { id: 'A', severity: 'critical', url: '/a', category: 'x', title: '', evidence: '', explanation: '', action: '' },
    { id: 'A', severity: 'critical', url: '/z', category: 'x', title: '', evidence: '', explanation: '', action: '' },
  ];
  const sorted = sortFindings(unsorted);
  assert.deepEqual(
    sorted.map((f) => `${f.severity}:${f.id}:${f.url}`),
    ['critical:A:/a', 'critical:A:/z', 'minor:B:/b'],
  );
});

test('hash missing target produces LINK_MISSING_HASH_TARGET', () => {
  const findings = analyzeLinks(
    {
      finalUrl: 'https://asi-global.ru/ru',
      hashLinks: ['#does-not-exist'],
      internalLinks: [],
      externalLinks: [],
      elementIds: ['pricing'],
    },
    BASE,
    {},
  );
  assert.ok(findings.some((f) => f.id === 'LINK_MISSING_HASH_TARGET'));
});

test('corpus extraction cleans scripts/styles leftovers', () => {
  const cleaned = cleanVisibleText('Hello <script>alert(1)</script> world <style>.x{}</style> end');
  assert.equal(cleaned.includes('script'), false);
  assert.equal(cleaned.includes('style'), false);
  assert.match(cleaned, /Hello/);
  const record = toCorpusRecord({
    requestedUrl: 'https://asi-global.ru/ru',
    finalUrl: 'https://asi-global.ru/ru',
    title: 'ASI',
    h1Texts: ['H1'],
    h2Texts: ['H2'],
    visibleText: 'Visible',
    ctaLabels: ['B', 'A'],
    internalLinks: ['https://asi-global.ru/ru/b', 'https://asi-global.ru/ru/a'],
  });
  assert.deepEqual(record.ctaLabels, ['A', 'B']);
  assert.deepEqual(record.internalLinkDestinations, [
    'https://asi-global.ru/ru/a',
    'https://asi-global.ru/ru/b',
  ]);
});

test('exit codes honor fail-on policy', () => {
  assert.equal(resolveExitCode({ critical: 0, major: 2, minor: 1, info: 0 }, 'critical'), 0);
  assert.equal(resolveExitCode({ critical: 1, major: 0, minor: 0, info: 0 }, 'critical'), 2);
  assert.equal(resolveExitCode({ critical: 0, major: 1, minor: 0, info: 0 }, 'major'), 2);
  assert.equal(resolveExitCode({ critical: 5, major: 5, minor: 5, info: 5 }, 'none'), 0);
});

test('runRuleEngine is deterministic for identical pages', () => {
  const page = {
    requestedUrl: 'https://asi-global.ru/ru',
    finalUrl: 'https://asi-global.ru/ru',
    status: 200,
    title: 'ASI',
    metaDescription: 'desc',
    h1Count: 1,
    h1Texts: ['Заголовок'],
    h2Texts: [],
    visibleText:
      'Подключение и настройка — 0 ₽. 14 дней работы — 0 ₽. После пилота — 1000 ₽ / объект в месяц.',
    ctaLabels: ['Подключить объект бесплатно'],
    internalLinks: [],
    hashLinks: [],
    externalLinks: [],
    elementIds: [],
    forms: [],
  };
  const a = runRuleEngine({ pages: [page], baseUrl: BASE, linkStatusMap: {} });
  const b = runRuleEngine({ pages: [page], baseUrl: BASE, linkStatusMap: {} });
  assert.deepEqual(
    a.map((f) => `${f.id}|${f.severity}|${f.url}`),
    b.map((f) => `${f.id}|${f.severity}|${f.url}`),
  );
});

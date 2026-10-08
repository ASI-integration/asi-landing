import assert from 'node:assert/strict';

const FIXTURE_NAME = 'ASI CRM ACCEPTANCE STRIGUNOV LOCAL';
const FIXTURE_USERNAME = 'asi_acceptance_local';
const OPERATOR_EMAIL = 'local-operator@acceptance.test';

function localSupabaseUrl(): URL {
  const raw = process.env.SUPABASE_URL;
  assert(raw, 'SUPABASE_URL is required for the isolated local CRM acceptance store.');

  const url = new URL(raw);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  assert(
    loopbackHosts.has(url.hostname),
    `Refusing non-loopback CRM acceptance target: ${url.hostname}`,
  );
  assert.equal(url.protocol, 'http:', 'Local CRM acceptance must use a loopback HTTP target.');
  assert.equal(url.port, '54321', 'Use the isolated local Supabase API port 54321.');
  return url;
}

function printPlan(): void {
  console.log([
    'Strigunov CRM local acceptance plan:',
    '1. Start an isolated local Supabase store with the tracked CRM migrations applied.',
    '2. Verify localhost:54321 is a real local fixture store, not a remote tunnel.',
    '3. Set NODE_ENV=test, ASI_LOCAL_CRM_ACCEPTANCE=1, SUPABASE_URL=http://127.0.0.1:54321, local-only service key.',
    '4. The runner submits through the real public route, reads through the real CRM repository,',
    '   checks queue projection, NOT authenticated HTTP operator UI, and deletes its own fixture.',
  ].join('\n'));
}

async function run(): Promise<void> {
  if (process.argv.includes('--plan')) {
    printPlan();
    return;
  }

  assert.equal(process.env.NODE_ENV, 'test', 'CRM acceptance requires NODE_ENV=test.');
  assert.equal(process.env.ASI_LOCAL_CRM_ACCEPTANCE, '1',
    'ASI_LOCAL_CRM_ACCEPTANCE=1 requires a verified local-only Supabase fixture store.');
  const target = localSupabaseUrl();
  assert(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_SERVICE_ROLE_KEY is required for the isolated local CRM acceptance store.',
  );

  const [{ POST }, repository, queue, access, rateLimit] = await Promise.all([
    import('../src/app/api/early-access/leads/route'),
    import('../src/lib/crm/repository'),
    import('../src/lib/crm/queue'),
    import('../src/lib/crm/access'),
    import('../src/lib/early-access/public-lead-rate-limit'),
  ]);

  const exactFixtures = async () => {
    const contacts = await repository.listCrmContacts({
      search: FIXTURE_NAME,
      includeTest: true,
    });
    return contacts.filter((contact) =>
      contact.name === FIXTURE_NAME &&
      contact.telegramUsername === FIXTURE_USERNAME &&
      contact.note.includes('Источник заявки: Стригунов'),
    );
  };

  const cleanup = async () => {
    for (const contact of await exactFixtures()) {
      await repository.deleteCrmContact(contact.id);
    }
  };

  assert.equal((await exactFixtures()).length, 0,
    'Matching fixture already exists; refusing deletion of pre-existing CRM data.');
  rateLimit.resetPublicPilotLeadRateLimitForTests();

  try {
    assert.equal(
      access.isCrmOperatorEmail(OPERATOR_EMAIL),
      true,
      'The synthetic local operator must pass the CRM operator access gate.',
    );

    const response = await POST(new Request('http://localhost/api/early-access/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: FIXTURE_NAME,
        contact: `@${FIXTURE_USERNAME}`,
        objectsCount: '2-5 объектов',
        referral: 'strigunov',
        consent: true,
        website: '',
      }),
    }));
    assert.equal(response.status, 201, `Public lead route returned ${response.status}.`);
    assert.deepEqual(await response.json(), { ok: true });

    const persisted = await exactFixtures();
    assert.equal(persisted.length, 1, 'Expected exactly one persisted CRM fixture.');
    const contact = persisted[0];
    assert.equal(contact.source, 'form');
    assert.equal(contact.status, 'new');
    assert.equal(contact.communicationStatus, 'needs_manual_reaction');
    assert.equal(contact.objectsCount, 2);

    const items = queue.buildQueueItems([contact]);
    const operatorInbox = queue.buildOperatorInbox(items);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, contact.id);
    assert.equal(items[0].column, 'needs_operator');
    assert.equal(items[0].needsOperator, true);
    assert.deepEqual(operatorInbox.map((item) => item.id), [contact.id]);

    console.log(JSON.stringify({
      ok: true,
      target: target.origin,
      persistedRecordId: contact.id,
      source: contact.source,
      communicationStatus: contact.communicationStatus,
      queueColumn: items[0].column,
      operatorQueueProjectionVisible: true,
    }, null, 2));
  } finally {
    await cleanup();
    assert.equal((await exactFixtures()).length, 0, 'CRM acceptance fixture cleanup failed.');
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

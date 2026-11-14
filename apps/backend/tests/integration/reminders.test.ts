import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
import { evaluateReminders } from '../../src/modules/communications/reminders.js';
import { providerRegistry } from '../../src/modules/communications/config.js';
import { runCommunicationsCycle } from '../../src/modules/communications/worker.js';
const api = testApi();
after(() => api.pool.end());

test('reminder evaluation commits at most 25 residents and resumes the same date without duplicates', async () => {
  const cookie = await api.agency();
  async function run(query: string, variables: Record<string, unknown> = {}) {
    const result = await api.query(cookie, query, variables);
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  const me = (await run('{me{agencyId}}')).me,
    route = await api.route(cookie);
  for (let index = 0; index < 26; index++) {
    const resident = (
      await run(
        'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            name: `Batch Resident ${index}`,
            address: '1 Lotus Lane',
            phone: '9876543210',
            sector: 'Lotus Lane',
            routeId: route.id,
            dropOrder: index + 1,
          },
        },
      )
    ).saveResident;
    await run(
      'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: resident.id,
          direction: 'DEBIT',
          category: 'OPENING',
          date: '2026-11-01',
          amount: '1.00',
          reason: 'Synthetic bounded evaluation',
        },
      },
    );
  }
  await run(
    'mutation($input:CommunicationSettingsInput!){saveCommunicationSettings(input:$input){version}}',
    {
      input: {
        requestId: randomUUID(),
        version: 0,
        remindersEnabled: true,
        frequencyDays: 7,
        cooldownHours: 24,
        reminderChannel: 'SMS',
      },
    },
  );
  const providers = providerRegistry({});
  const first = await evaluateReminders(api.pool, me.agencyId, providers);
  assert.equal(first.created, 25);
  const second = await evaluateReminders(api.pool, me.agencyId, providers);
  assert.equal(second.created, 1);
  assert.equal(
    (await evaluateReminders(api.pool, me.agencyId, providers)).created,
    0,
  );
  const rows = await withTenant(
    api.pool,
    me.agencyId,
    async (c) =>
      (await c.query('SELECT resident_id FROM daybook.notification_intents'))
        .rows,
  );
  assert.equal(rows.length, 26);
  assert.equal(new Set(rows.map((row) => row.resident_id)).size, 26);
});
test('a consented overdue account without an invoice gets a system PDF before a single synthetic provider submission', async () => {
  process.env.DOCUMENT_LINK_SECRET =
    'synthetic-reminder-link-secret-012345678901234567890';
  process.env.PUBLIC_APP_ORIGIN = 'https://reminders.example.test';
  const cookie = await api.agency();
  async function run(query: string, variables: Record<string, unknown> = {}) {
    const result = await api.query(cookie, query, variables);
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  const me = (await run('{me{id agencyId}}')).me,
    route = await api.route(cookie);
  const resident = (
    await run(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Consented Reminder Resident',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).saveResident;
  await run(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        direction: 'DEBIT',
        category: 'OPENING',
        date: '2026-11-01',
        amount: '30.25',
        reason: 'Synthetic overdue account without invoice',
      },
    },
  );
  await run(
    'mutation{saveCollectionSettings(input:{upiId:"reminders@upi",payeeName:"Domain Tests",confirmOwnership:true}){version}}',
  );
  await run(
    'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        version: 0,
        locale: 'hi',
        whatsapp: false,
        sms: true,
        confirmedConsent: true,
        evidence: 'Synthetic resident SMS opt-in',
      },
    },
  );
  await run(
    'mutation($input:CommunicationSettingsInput!){saveCommunicationSettings(input:$input){version}}',
    {
      input: {
        requestId: randomUUID(),
        version: 0,
        remindersEnabled: true,
        frequencyDays: 7,
        cooldownHours: 24,
        reminderChannel: 'SMS',
      },
    },
  );
  const providers = providerRegistry({
    TOKEN: 'synthetic',
    DAYBOOK_COMMUNICATIONS_PROVIDERS: JSON.stringify({
      [me.agencyId]: {
        sms: {
          accountSid: 'AC123',
          messagingServiceSid: 'MG123',
          authTokenEnv: 'TOKEN',
        },
      },
    }),
  });
  let sent = 0;
  await withTenant(api.pool, me.agencyId, (c) =>
    c.query(
      "INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,payload,dedupe_key,status,created_by) VALUES($1,$2,$3,'REMINDER','SMS','+919876543210',jsonb_build_object('kind','REMINDER','sourceDate','2026-11-01'),'synthetic-yesterday-backlog','WAITING_DOCUMENT',$4)",
      [randomUUID(), me.agencyId, resident.id, me.id],
    ),
  );
  const cycle = await runCommunicationsCycle(
    api.pool,
    me.agencyId,
    providers,
    async (_config, message) => {
      sent++;
      assert.equal(message.recipient, '+919876543210');
      assert.ok(message.body.includes('30.25'));
      assert.ok(message.body.includes('/documents/public/'));
      return { status: 'ACCEPTED', messageId: 'synthetic-reminder-accepted' };
    },
  );
  assert.equal(sent, 1);
  assert.equal(cycle.messages[0].status, 'ACCEPTED');
  await runCommunicationsCycle(api.pool, me.agencyId, providers, async () => {
    throw new Error('Must not resubmit');
  });
  assert.equal(sent, 1);
  const doc = await withTenant(
    api.pool,
    me.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT kind,status,created_by,actor_kind,pdf,snapshot FROM daybook.documents WHERE resident_id=$1',
          [resident.id],
        )
      ).rows[0],
  );
  assert.equal(doc.kind, 'ACCOUNT_NOTICE');
  assert.equal(doc.status, 'READY');
  assert.equal(doc.created_by, null);
  assert.equal(doc.actor_kind, 'SYSTEM');
  assert.ok(doc.pdf.subarray(0, 4).toString() === '%PDF');
  assert.equal(doc.snapshot.locale, 'hi');
});
test('reminders evaluate only the current agency date once, catch up without a daily blast, and record a system actor', async () => {
  const cookie = await api.agency();
  const me = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const route = await api.route(cookie);
  async function run(query: string, variables: Record<string, unknown> = {}) {
    const result = await api.query(cookie, query, variables);
    assert.ok(!result.errors, JSON.stringify(result));
    return result.data;
  }
  const resident = (
    await run(
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Reminder Resident',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).saveResident;
  await run(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        direction: 'DEBIT',
        category: 'OPENING',
        amount: '25.05',
        reason: 'Synthetic old opening balance',
      },
    },
  );
  const settings = {
    requestId: randomUUID(),
    version: 0,
    remindersEnabled: true,
    frequencyDays: 7,
    cooldownHours: 24,
    reminderChannel: 'SMS',
  };
  await run(
    'mutation($input:CommunicationSettingsInput!){saveCommunicationSettings(input:$input){version}}',
    { input: settings },
  );
  const providers = providerRegistry({});
  const midnight = new Date('2026-12-01T18:30:00.000Z');
  const results = await Promise.all([
    evaluateReminders(api.pool, me.agencyId, providers, midnight),
    evaluateReminders(api.pool, me.agencyId, providers, midnight),
  ]);
  assert.equal(
    results.reduce((sum, row) => sum + row.created, 0),
    1,
  );
  assert.ok(results.every((row) => row.date === '2026-12-02'));
  const rows = await withTenant(
    api.pool,
    me.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT kind,status,created_by,actor_kind,payload FROM daybook.notification_intents',
        )
      ).rows,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'REMINDER');
  assert.equal(rows[0].status, 'NOT_CONFIGURED');
  assert.equal(rows[0].created_by, null);
  assert.equal(rows[0].actor_kind, 'SYSTEM');
  assert.equal(rows[0].payload.amount, '25.05');
  const catchup = await evaluateReminders(
    api.pool,
    me.agencyId,
    providers,
    new Date('2026-12-20T18:30:00Z'),
  );
  assert.equal(catchup.created, 1);
  assert.equal(catchup.date, '2026-12-21');
  const evaluationDates = await withTenant(
    api.pool,
    me.agencyId,
    async (c) =>
      (
        await c.query(
          "SELECT to_char(evaluation_date,'YYYY-MM-DD') AS date FROM daybook.communication_evaluations ORDER BY evaluation_date",
        )
      ).rows,
  );
  assert.deepEqual(
    evaluationDates.map((row) => row.date),
    ['2026-12-02', '2026-12-21'],
  );
  await withTenant(api.pool, me.agencyId, (c) =>
    c.query(
      "UPDATE daybook.notification_intents SET status='ACCEPTED',accepted_at=$1 WHERE kind='REMINDER' AND payload->>'sourceDate'='2026-12-21'",
      [new Date('2026-12-20T18:30:00Z')],
    ),
  );
  assert.equal(
    (
      await evaluateReminders(
        api.pool,
        me.agencyId,
        providers,
        new Date('2026-12-26T18:30:00Z'),
      )
    ).created,
    0,
  );
  assert.equal(
    (
      await evaluateReminders(
        api.pool,
        me.agencyId,
        providers,
        new Date('2026-12-27T18:30:00Z'),
      )
    ).created,
    1,
  );
});

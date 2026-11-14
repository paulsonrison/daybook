import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
import { providerRegistry } from '../../src/modules/communications/config.js';
import { runCommunicationsCycle } from '../../src/modules/communications/worker.js';
import { withTenant } from '../../src/db/tenant.js';
let providers = providerRegistry({});
const api = testApi({
  get: (agency, channel) => providers.get(agency, channel),
});
after(() => api.pool.end());
test('manual reminder preparation is tenant-scoped, original-request safe and never claims an unconfigured send', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
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
          name: 'Manual Reminder Resident',
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
        amount: '12.50',
        reason: 'Synthetic overdue manual reminder',
      },
    },
  );
  const query =
    'mutation($input:QueueReminderInput!){queueReminder(input:$input){id kind channel status documentId documentStatus}}';
  const input = {
    requestId: randomUUID(),
    residentId: resident.id,
    channel: 'SMS',
  };
  const first = (await run(query, { input })).queueReminder;
  assert.equal(first.status, 'NOT_CONFIGURED');
  assert.equal(first.kind, 'REMINDER');
  assert.equal(first.channel, 'SMS');
  assert.equal((await run(query, { input })).queueReminder.id, first.id);
  const foreign = await api.query(await api.agency(), query, { input });
  assert.ok(foreign.errors);
  assert.equal(
    (await run('{messageDispatches{id}}')).messageDispatches.length,
    1,
  );
  process.env.DOCUMENT_LINK_SECRET =
    'synthetic-manual-link-secret-012345678901234567890';
  process.env.PUBLIC_APP_ORIGIN = 'https://manual.example.test';
  const me = (await run('{me{agencyId}}')).me;
  providers = providerRegistry({
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
  await run(
    'mutation{saveCollectionSettings(input:{upiId:"manual@upi",payeeName:"Domain Tests",confirmOwnership:true}){version}}',
  );
  await run(
    'mutation($input:ContactPreferenceInput!){saveContactPreference(input:$input){version}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        version: 0,
        locale: 'en',
        whatsapp: false,
        sms: true,
        confirmedConsent: true,
        evidence: 'Synthetic manual SMS reminder opt-in',
      },
    },
  );
  const manualInput = { ...input, requestId: randomUUID() };
  assert.equal(
    (await run(query, { input: manualInput })).queueReminder.status,
    'WAITING_DOCUMENT',
  );
  let sent = 0;
  await runCommunicationsCycle(api.pool, me.agencyId, providers, async () => {
    sent++;
    return {
      status: 'ACCEPTED',
      messageId: 'synthetic-manual-reminder-accepted',
    };
  });
  assert.equal(sent, 1);
  assert.equal(
    (await run(query, { input: manualInput })).queueReminder.status,
    'ACCEPTED',
  );
  const deliveredDocument = (await run(query, { input: manualInput }))
    .queueReminder;
  assert.ok(deliveredDocument.documentId);
  assert.equal(deliveredDocument.documentStatus, 'READY');
  assert.equal((await run(query, { input })).queueReminder.id, first.id);
  const exhaustedInput = { ...input, requestId: randomUUID() };
  const exhausted = (await run(query, { input: exhaustedInput })).queueReminder;
  await withTenant(api.pool, me.agencyId, async (c) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await c.query(
        "UPDATE daybook.documents SET status='GENERATING',attempts=attempts+1,lease_until=now()+interval '60 seconds' WHERE id=(SELECT (payload->>'documentId')::uuid FROM daybook.notification_intents WHERE id=$1)",
        [exhausted.id],
      );
      await c.query(
        "UPDATE daybook.documents SET status='FAILED',lease_until=NULL,last_error='SYNTHETIC_RENDER_FAILURE' WHERE id=(SELECT (payload->>'documentId')::uuid FROM daybook.notification_intents WHERE id=$1)",
        [exhausted.id],
      );
    }
  });
  await runCommunicationsCycle(api.pool, me.agencyId, providers, async () => {
    throw new Error('A failed document must not submit');
  });
  assert.equal(
    (await run(query, { input: exhaustedInput })).queueReminder.status,
    'FAILED',
  );
  await run(
    'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        direction: 'CREDIT',
        category: 'CORRECTION',
        amount: '12.50',
        reason: 'Synthetic account fully settled before reminder',
      },
    },
  );
  assert.equal(
    (await run(query, { input: { ...input, requestId: randomUUID() } }))
      .queueReminder.status,
    'NOT_DUE',
  );
});

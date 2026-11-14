import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { withTenant } from '../../src/db/tenant.js';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());

test('retry limits, rejection delays, concurrent claims and tenant boundaries are enforced', async () => {
  const module = await import('../../src/modules/communications/outbox.js');
  const cookie = await api.agency();
  const me = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const other = (await api.query(await api.agency(), '{me{agencyId}}')).data.me
    .agencyId;
  const route = await api.route(cookie);
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Retry Test',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  async function seed() {
    const id = randomUUID();
    await withTenant(api.pool, me.agencyId, (c) =>
      c.query(
        `INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,payload,dedupe_key,status,created_by,next_attempt_at) VALUES($1::uuid,$2,$3,'INVOICE','SMS','+919876543210','{}',$1::text,'PENDING',$4,'2000-01-01Z')`,
        [id, me.agencyId, resident.id, me.id],
      ),
    );
    return id;
  }
  async function status(id: string) {
    return withTenant(
      api.pool,
      me.agencyId,
      async (c) =>
        (
          await c.query(
            'SELECT status,attempts FROM daybook.notification_intents WHERE id=$1',
            [id],
          )
        ).rows[0],
    );
  }
  let now = new Date();
  const exhausted = await seed();
  const claims = await Promise.all([
    module.claimMessage(api.pool, me.agencyId, now),
    module.claimMessage(api.pool, me.agencyId, now),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const first = claims.find(Boolean)!;
  assert.equal(
    await module.beginSubmission(
      api.pool,
      other,
      exhausted,
      first.attempts,
      now,
      async () => true,
    ),
    false,
  );
  assert.equal(
    await module.finishSubmission(
      api.pool,
      other,
      exhausted,
      first.attempts,
      { status: 'ACCEPTED', messageId: 'SM-foreign' },
      now,
    ),
    false,
  );
  for (let attempt = 2; attempt <= 5; attempt++) {
    now = new Date(now.getTime() + 61000);
    assert.equal(
      (await module.claimMessage(api.pool, me.agencyId, now))?.attempts,
      attempt,
    );
  }
  now = new Date(now.getTime() + 61000);
  assert.equal(await module.claimMessage(api.pool, me.agencyId, now), null);
  assert.deepEqual(await status(exhausted), { status: 'FAILED', attempts: 5 });
  const retried = await seed();
  for (let attempt = 1; attempt <= 5; attempt++) {
    const claim = await module.claimMessage(api.pool, me.agencyId, now);
    assert.equal(claim?.id, retried);
    assert.equal(claim?.attempts, attempt);
    assert.equal(
      await module.beginSubmission(
        api.pool,
        me.agencyId,
        retried,
        attempt,
        now,
        async () => true,
      ),
      true,
    );
    assert.equal(
      await module.finishSubmission(
        api.pool,
        me.agencyId,
        retried,
        attempt,
        {
          status: 'REJECTED',
          retryable: true,
          errorCode: 'HTTP_429',
          retryAfterSeconds: 120,
        },
        now,
      ),
      true,
    );
    assert.equal(
      await module.claimMessage(
        api.pool,
        me.agencyId,
        new Date(now.getTime() + 119000),
      ),
      null,
    );
    now = new Date(now.getTime() + 120000);
  }
  assert.deepEqual(await status(retried), { status: 'FAILED', attempts: 5 });
  const rejected = await seed();
  const claim = await module.claimMessage(api.pool, me.agencyId, now);
  assert.equal(claim?.id, rejected);
  assert.equal(
    await module.beginSubmission(
      api.pool,
      me.agencyId,
      rejected,
      1,
      now,
      async () => true,
    ),
    true,
  );
  assert.equal(
    await module.finishSubmission(
      api.pool,
      me.agencyId,
      rejected,
      1,
      { status: 'REJECTED', retryable: false, errorCode: 'HTTP_401' },
      now,
    ),
    true,
  );
  assert.deepEqual(await status(rejected), { status: 'FAILED', attempts: 1 });
});

test('outbox lease fencing retries only before submission; uncertain submissions stay blocked', async () => {
  const path = '../../src/modules/communications/outbox.js';
  const module = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(module?.claimMessage, 'Durable outbox lease operations must exist');
  const cookie = await api.agency();
  const me = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const route = await api.route(cookie);
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Outbox Test',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  const id = randomUUID();
  await withTenant(api.pool, me.agencyId, (c) =>
    c.query(
      `INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,payload,dedupe_key,status,created_by,next_attempt_at) VALUES($1::uuid,$2,$3,'INVOICE','SMS','+919876543210','{}',$1::text,'PENDING',$4,'2000-01-01Z')`,
      [id, me.agencyId, resident.id, me.id],
    ),
  );
  const now = new Date();
  const first = await module.claimMessage(api.pool, me.agencyId, now);
  assert.equal(first.id, id);
  assert.equal(first.attempts, 1);
  let checked = false;
  assert.equal(
    await module.beginSubmission(
      api.pool,
      me.agencyId,
      id,
      first.attempts,
      now,
      async (client: {
        query: (sql: string) => Promise<{ rows: { agency: string }[] }>;
      }) => {
        checked = true;
        assert.equal(
          (await client.query('SELECT daybook.current_agency() AS agency'))
            .rows[0].agency,
          me.agencyId,
        );
        return false;
      },
    ),
    false,
  );
  assert.equal(checked, true);
  assert.equal(await module.claimMessage(api.pool, me.agencyId, now), null);
  const later = new Date(now.getTime() + 61000);
  const second = await module.claimMessage(api.pool, me.agencyId, later);
  assert.equal(second.id, id);
  assert.equal(second.attempts, 2);
  assert.equal(
    await module.beginSubmission(
      api.pool,
      me.agencyId,
      id,
      first.attempts,
      later,
      async () => true,
    ),
    false,
  );
  assert.equal(
    await module.beginSubmission(
      api.pool,
      me.agencyId,
      id,
      second.attempts,
      later,
      async () => true,
    ),
    true,
  );
  assert.equal(
    await module.claimMessage(
      api.pool,
      me.agencyId,
      new Date(later.getTime() + 61000),
    ),
    null,
  );
  const row = await withTenant(
    api.pool,
    me.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT status,attempts FROM daybook.notification_intents WHERE id=$1',
          [id],
        )
      ).rows[0],
  );
  assert.equal(row.status, 'UNKNOWN');
  assert.equal(row.attempts, 2);
  assert.equal(
    await module.beginSubmission(
      api.pool,
      me.agencyId,
      id,
      second.attempts,
      later,
      async () => true,
    ),
    false,
  );
  const other = (await api.query(await api.agency(), '{me{agencyId}}')).data.me
    .agencyId;
  assert.equal(await module.claimMessage(api.pool, other, later), null);
  assert.ok(
    module.finishSubmission,
    'Fenced provider results must be persisted',
  );
  async function requiresSharedLock(work: () => Promise<boolean>) {
    let pending: Promise<boolean> | undefined;
    let settled = false;
    let waiting = false;
    await withTenant(api.pool, me.agencyId, async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
        [me.agencyId],
      );
      pending = work().finally(() => {
        settled = true;
      });
      for (let i = 0; i < 100 && !settled && !waiting; i++) {
        waiting = (
          await api.pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory') AS waiting",
          )
        ).rows[0].waiting;
        if (!waiting && !settled)
          await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    await pending;
    assert.equal(
      waiting,
      true,
      'Callback and HTTP association must share a transaction lock before either writes',
    );
  }
  await requiresSharedLock(() =>
    module.finishSubmission(
      api.pool,
      me.agencyId,
      id,
      first.attempts,
      { status: 'ACCEPTED', messageId: 'SM-stale' },
      later,
    ),
  );
  await requiresSharedLock(() =>
    module.recordProviderEvent(api.pool, me.agencyId, {
      channel: 'SMS',
      messageId: 'SM-accepted',
      status: 'DELIVERED',
      eventKey: 'before-http-ack',
    }),
  );
  assert.equal(
    await module.recordProviderEvent(api.pool, me.agencyId, {
      channel: 'SMS',
      messageId: 'SM-accepted',
      status: 'DELIVERED',
      eventKey: 'before-http-ack',
    }),
    false,
  );
  assert.equal(
    await module.finishSubmission(
      api.pool,
      me.agencyId,
      id,
      first.attempts,
      { status: 'ACCEPTED', messageId: 'SM-stale' },
      later,
    ),
    false,
  );
  assert.equal(
    await module.finishSubmission(
      api.pool,
      me.agencyId,
      id,
      second.attempts,
      { status: 'ACCEPTED', messageId: 'SM-accepted' },
      later,
    ),
    true,
  );
  assert.equal(
    await module.finishSubmission(
      api.pool,
      me.agencyId,
      id,
      second.attempts,
      { status: 'UNKNOWN', errorCode: 'SUBMISSION_UNCERTAIN' },
      later,
    ),
    false,
  );
  const accepted = await withTenant(
    api.pool,
    me.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT status,provider_message_id FROM daybook.notification_intents WHERE id=$1',
          [id],
        )
      ).rows[0],
  );
  assert.equal(accepted.status, 'DELIVERED');
  assert.equal(accepted.provider_message_id, 'SM-accepted');
  assert.ok(
    module.recordProviderEvent,
    'Verified provider events must update delivery monotonically',
  );
  const event = {
    channel: 'SMS',
    messageId: 'SM-accepted',
    status: 'READ',
    eventKey: 'synthetic-read',
  };
  assert.equal(await module.recordProviderEvent(api.pool, other, event), false);
  assert.equal(
    await module.recordProviderEvent(api.pool, me.agencyId, {
      ...event,
      channel: 'WHATSAPP',
    }),
    false,
  );
  assert.equal(
    await module.recordProviderEvent(api.pool, me.agencyId, event),
    true,
  );
  assert.equal(
    await module.recordProviderEvent(api.pool, me.agencyId, event),
    false,
  );
  assert.equal(
    await module.recordProviderEvent(api.pool, me.agencyId, {
      ...event,
      status: 'DELIVERED',
      eventKey: 'synthetic-late-delivered',
    }),
    false,
  );
  assert.equal(
    await module.recordProviderEvent(api.pool, me.agencyId, {
      ...event,
      status: 'FAILED',
      eventKey: 'synthetic-late-failed',
    }),
    false,
  );
  assert.equal(
    await module.finishSubmission(
      api.pool,
      me.agencyId,
      id,
      second.attempts,
      { status: 'ACCEPTED', messageId: 'SM-accepted' },
      later,
    ),
    false,
  );
  const final = await withTenant(
    api.pool,
    me.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT status,(SELECT count(*)::int FROM daybook.notification_events WHERE intent_id=$1) AS events FROM daybook.notification_intents WHERE id=$1',
          [id],
        )
      ).rows[0],
  );
  assert.deepEqual(final, { status: 'READ', events: 4 });
  assert.equal(
    await module.claimMessage(
      api.pool,
      me.agencyId,
      new Date(later.getTime() + 3600000),
    ),
    null,
  );
});

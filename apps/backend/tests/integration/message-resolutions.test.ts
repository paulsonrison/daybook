import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
import {
  associateSmsCallback,
  recordProviderEvent,
  finishSubmission,
} from '../../src/modules/communications/outbox.js';
const api = testApi();
after(() => api.pool.end());
const mutation =
  'mutation($input:MessageResolutionInput!){resolveMessageUncertainty(input:$input){id status reason}}';
test('late provider acceptance supersedes every owner assessment with the original attempt fence', async () => {
  for (const decision of [
    'CLOSE_UNKNOWN',
    'CONFIRMED_NOT_SENT',
    'CONFIRMED_ACCEPTED',
  ]) {
    const f = await fixture();
    const result = await api.query(f.cookie, mutation, {
      input: {
        requestId: randomUUID(),
        messageId: f.id,
        decision,
        evidence:
          'Verified synthetic assessment before delayed acknowledgement',
        confirmedEvidence: true,
        ...(decision === 'CONFIRMED_ACCEPTED'
          ? { providerReference: 'Synthetic owner reference' }
          : {}),
      },
    });
    assert.ok(result.data?.resolveMessageUncertainty, JSON.stringify(result));
    assert.equal(
      await finishSubmission(api.pool, f.me.agencyId, f.id, 1, {
        status: 'UNKNOWN',
        errorCode: 'TIMEOUT',
      }),
      false,
    );
    assert.equal(
      await finishSubmission(api.pool, f.me.agencyId, f.id, 2, {
        status: 'ACCEPTED',
        messageId: 'wrong-attempt',
      }),
      false,
    );
    assert.equal(
      await finishSubmission(api.pool, f.me.agencyId, f.id, 1, {
        status: 'ACCEPTED',
        messageId: 'synthetic-late-' + decision,
      }),
      true,
    );
    assert.equal(
      await finishSubmission(api.pool, f.me.agencyId, f.id, 1, {
        status: 'ACCEPTED',
        messageId: 'conflicting-provider-id',
      }),
      false,
    );
    const row = await withTenant(
      api.pool,
      f.me.agencyId,
      async (c) =>
        (
          await c.query(
            'SELECT status,provider_message_id FROM daybook.notification_intents WHERE id=$1',
            [f.id],
          )
        ).rows[0],
    );
    assert.deepEqual(row, {
      status: 'ACCEPTED',
      provider_message_id: 'synthetic-late-' + decision,
    });
  }
});
async function fixture() {
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
          name: 'Resolution Resident',
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
      `INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,payload,dedupe_key,status,created_by,attempts,submitted_at) VALUES($1::uuid,$2,$3,'INVOICE','SMS','+919876543210',$4,$1::text,'UNKNOWN',$5,1,now())`,
      [
        id,
        me.agencyId,
        resident.id,
        JSON.stringify({ sentinel: 'Original immutable message snapshot' }),
        me.id,
      ],
    ),
  );
  return { cookie, me, resident, id };
}
test('uncertain sends close with unknown outcome or require explicit evidenced owner verification, preserving original retries and audit', async () => {
  const f = await fixture();
  const input = {
    requestId: randomUUID(),
    messageId: f.id,
    decision: 'CLOSE_UNKNOWN',
    evidence: 'Provider support case remains unresolved',
    confirmedEvidence: true,
  };
  const missing = await api.query(f.cookie, mutation, {
    input: { ...input, confirmedEvidence: false },
  });
  assert.ok(missing.errors);
  const foreign = await api.query(await api.agency(), mutation, { input });
  assert.ok(foreign.errors);
  const closed = await api.query(f.cookie, mutation, { input });
  assert.ok(closed.data?.resolveMessageUncertainty, JSON.stringify(closed));
  assert.equal(closed.data.resolveMessageUncertainty.status, 'UNKNOWN_CLOSED');
  const notSent = await api.query(f.cookie, mutation, {
    input: {
      ...input,
      requestId: randomUUID(),
      decision: 'CONFIRMED_NOT_SENT',
      evidence:
        'Provider support explicitly verified this submission was never accepted',
    },
  });
  assert.equal(notSent.data.resolveMessageUncertainty.status, 'OWNER_NOT_SENT');
  assert.equal(
    (await api.query(f.cookie, mutation, { input })).data
      .resolveMessageUncertainty.status,
    'OWNER_NOT_SENT',
  );
  const history = await api.query(
    f.cookie,
    'query($id:ID!){messageResolutions(messageId:$id){decision evidence agentName createdAt}}',
    { id: f.id },
  );
  assert.equal(history.data.messageResolutions.length, 2);
  assert.ok(
    history.data.messageResolutions.every(
      (row: { agentName: string }) => row.agentName === 'Owner',
    ),
  );
  const proof = await withTenant(
    api.pool,
    f.me.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT recipient,payload FROM daybook.notification_intents WHERE id=$1',
          [f.id],
        )
      ).rows[0],
  );
  assert.deepEqual(proof, {
    recipient: '+919876543210',
    payload: { sentinel: 'Original immutable message snapshot' },
  });
});
test('owner-verified acceptance remains distinct from a provider response and a later signed SMS outcome can supersede it', async () => {
  const f = await fixture();
  const input = {
    requestId: randomUUID(),
    messageId: f.id,
    decision: 'CONFIRMED_ACCEPTED',
    evidence:
      'Owner checked the exact recipient and submission in the provider dashboard',
    providerReference: 'Dashboard record SYNTHETIC-123',
    confirmedEvidence: true,
  };
  const result = await api.query(f.cookie, mutation, { input });
  assert.ok(result.data?.resolveMessageUncertainty, JSON.stringify(result));
  assert.equal(result.data.resolveMessageUncertainty.status, 'OWNER_ACCEPTED');
  const row = await withTenant(
    api.pool,
    f.me.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT provider_message_id,accepted_at IS NOT NULL AS recorded FROM daybook.notification_intents WHERE id=$1',
          [f.id],
        )
      ).rows[0],
  );
  assert.deepEqual(row, { provider_message_id: null, recorded: true });
  assert.equal(
    await associateSmsCallback(
      api.pool,
      f.me.agencyId,
      f.id,
      'SM-provider-verified',
      '+919876543210',
    ),
    true,
  );
  assert.equal(
    await recordProviderEvent(api.pool, f.me.agencyId, {
      channel: 'SMS',
      messageId: 'SM-provider-verified',
      status: 'DELIVERED',
      eventKey: 'synthetic-delivery-proof',
    }),
    true,
  );
  assert.equal(
    (await api.query(f.cookie, mutation, { input })).data
      .resolveMessageUncertainty.status,
    'DELIVERED',
  );
  const lateOwnerDecision = await api.query(f.cookie, mutation, {
    input: {
      ...input,
      requestId: randomUUID(),
      decision: 'CONFIRMED_NOT_SENT',
      providerReference: null,
      evidence: 'An outdated owner assessment must not override delivery',
    },
  });
  assert.ok(lateOwnerDecision.errors);
});

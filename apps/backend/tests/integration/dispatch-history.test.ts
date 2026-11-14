import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
const api = testApi();
after(() => api.pool.end());
test('dispatch history traverses every tied-date record with tenant-scoped recipient and status filters', async () => {
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
          name: 'History Resident',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  await withTenant(api.pool, me.agencyId, (c) =>
    c.query(
      `INSERT INTO daybook.notification_intents(id,agency_id,resident_id,kind,channel,recipient,payload,dedupe_key,status,created_by,created_at) SELECT gen_random_uuid(),$1,$2,'INVOICE','SMS','+919876543210','{}'::jsonb,'synthetic-history-'||n,CASE WHEN n%2=0 THEN 'FAILED' ELSE 'NOT_CONFIGURED' END,$3,'2026-11-01T12:00:00Z'::timestamptz FROM generate_series(1,205) n`,
      [me.agencyId, resident.id, me.id],
    ),
  );
  const query =
    'query($input:DispatchHistoryInput!){dispatchHistory(input:$input){hasMore items{id status residentId createdAt}}}';
  const first = await api.query(cookie, query, { input: {} });
  assert.ok(first.data?.dispatchHistory, JSON.stringify(first));
  assert.equal(first.data.dispatchHistory.items.length, 200);
  assert.equal(first.data.dispatchHistory.hasMore, true);
  const last = first.data.dispatchHistory.items.at(-1);
  const second = await api.query(cookie, query, {
    input: { beforeCreatedAt: last.createdAt, beforeId: last.id },
  });
  assert.equal(second.data.dispatchHistory.items.length, 5);
  assert.equal(second.data.dispatchHistory.hasMore, false);
  assert.equal(
    new Set(
      [
        ...first.data.dispatchHistory.items,
        ...second.data.dispatchHistory.items,
      ].map((row) => row.id),
    ).size,
    205,
  );
  const filtered = await api.query(cookie, query, {
    input: { residentId: resident.id, status: 'FAILED' },
  });
  assert.equal(filtered.data.dispatchHistory.items.length, 102);
  const foreign = await api.query(await api.agency(), query, {
    input: { residentId: resident.id },
  });
  assert.ok(foreign.errors);
  assert.ok(
    (await api.query(cookie, query, { input: { beforeId: last.id } })).errors,
  );
  await withTenant(api.pool, me.agencyId, (c) =>
    c.query(
      "INSERT INTO daybook.contact_attempts(id,agency_id,resident_id,request_id,channel,phone_snapshot,created_by,created_at) SELECT gen_random_uuid(),$1,$2,gen_random_uuid(),'CALL','+919876543210',$3,'2026-11-01T12:00:00Z'::timestamptz FROM generate_series(1,205)",
      [me.agencyId, resident.id, me.id],
    ),
  );
  const contactQuery =
    'query($id:ID!,$attempts:CommunicationCursorInput,$messages:CommunicationCursorInput){communicationHistory(residentId:$id,attemptsBefore:$attempts,messagesBefore:$messages){attemptsHasMore messagesHasMore attempts{id createdAt}messages{id createdAt}}}';
  const contactFirst = await api.query(cookie, contactQuery, {
    id: resident.id,
  });
  assert.ok(
    contactFirst.data?.communicationHistory,
    JSON.stringify(contactFirst),
  );
  const h = contactFirst.data.communicationHistory;
  assert.equal(h.attempts.length, 200);
  assert.equal(h.messages.length, 200);
  assert.equal(h.attemptsHasMore, true);
  assert.equal(h.messagesHasMore, true);
  const contactNext = await api.query(cookie, contactQuery, {
    id: resident.id,
    attempts: h.attempts.at(-1),
    messages: h.messages.at(-1),
  });
  assert.ok(
    contactNext.data?.communicationHistory,
    JSON.stringify(contactNext),
  );
  const next = contactNext.data.communicationHistory;
  assert.equal(next.attempts.length, 5);
  assert.equal(next.messages.length, 5);
  assert.equal(next.attemptsHasMore, false);
  assert.equal(next.messagesHasMore, false);
  assert.equal(
    new Set([...h.attempts, ...next.attempts].map((row) => row.id)).size,
    205,
  );
  assert.equal(
    new Set([...h.messages, ...next.messages].map((row) => row.id)).size,
    205,
  );
  assert.ok(
    (await api.query(await api.agency(), contactQuery, { id: resident.id }))
      .errors,
  );
});

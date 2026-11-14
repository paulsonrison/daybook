import assert from 'node:assert/strict';
import test from 'node:test';

test('unconfirmed contact attempts retain each original nonce across resident changes, reload and agency isolation', async () => {
  const path = './attempts.js';
  const feature = await import(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  });
  assert.ok(
    feature?.ContactAttemptQueue,
    'Persistent contact-attempt recovery must exist',
  );
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const agency = '00000000-0000-4000-8000-000000000001';
  const resident = '00000000-0000-4000-8000-000000000002';
  const first = {
    requestId: '00000000-0000-4000-8000-000000000003',
    residentId: resident,
    channel: 'CALL',
  };
  const second = {
    ...first,
    requestId: '00000000-0000-4000-8000-000000000004',
    channel: 'WHATSAPP',
  };
  const queue = new feature.ContactAttemptQueue(agency, storage);
  queue.add(first);
  queue.add(second);
  assert.deepEqual(new feature.ContactAttemptQueue(agency, storage).items, [
    first,
    second,
  ]);
  assert.deepEqual(
    new feature.ContactAttemptQueue(resident, storage).items,
    [],
  );
  queue.acknowledge(second.requestId);
  assert.deepEqual(new feature.ContactAttemptQueue(agency, storage).items, [
    first,
  ]);
  queue.add(first);
  assert.deepEqual(queue.items, [first]);
  assert.throws(() => queue.add({ ...first, channel: 'WHATSAPP' }), /original/);
  const remounted = new feature.ContactAttemptQueue(agency, storage);
  remounted.add(second);
  queue.acknowledge(first.requestId);
  assert.deepEqual(
    new feature.ContactAttemptQueue(agency, storage).items,
    [second],
    'An old screen must not erase a newer screen’s pending attempt',
  );
  values.set(`daybook:contact-attempts:${agency}`, 'corrupted');
  assert.throws(() => queue.add(first), /recovery/);
  assert.equal(values.get(`daybook:contact-attempts:${agency}`), 'corrupted');
  values.set(`daybook:contact-attempts:${agency}`, JSON.stringify([second]));
  queue.retryPersistence();
  assert.deepEqual(queue.items, [second, first]);
  const blocked = new feature.ContactAttemptQueue(agency, {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  });
  assert.equal(blocked.available, false);
  assert.throws(() => blocked.add(first), /recovery/);
});

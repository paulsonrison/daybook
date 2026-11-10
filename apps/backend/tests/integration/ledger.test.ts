import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../../src/db/tenant.js';
import {
  postEntry,
  settleResident,
  residentLedger,
  type LedgerPost,
} from '../../src/modules/ledger/service.js';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
async function fixture() {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    identity = (
      await api.query(cookie, '{me{agencyId} deliveryMetrics{today}}')
    ).data;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Ledger Resident',
          address: '12 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  return {
    cookie,
    agencyId: identity.me.agencyId,
    residentId: resident.id,
    date: identity.deliveryMetrics.today,
  };
}
test('immutable signed ledger settles oldest due debt without reposting money and retains exact overpayment credit', async () => {
  const f = await fixture();
  await withTenant(api.pool, f.agencyId, async (c) => {
    const base = {
      agencyId: f.agencyId,
      residentId: f.residentId,
      date: f.date,
      kind: 'OPENING',
      description: 'Imported opening balance',
    };
    const old = await postEntry(c, {
        ...base,
        sourceKey: 'opening:old',
        amountPaise: 10010n,
        dueDate: '2024-01-01',
      }),
      second = await postEntry(c, {
        ...base,
        sourceKey: 'opening:new',
        amountPaise: 5025n,
        dueDate: '2024-02-01',
      });
    assert.ok(old?.id);
    assert.ok(second?.id);
    const payment: LedgerPost = {
      ...base,
      kind: 'PAYMENT',
      sourceKey: 'payment:first',
      amountPaise: -6005n,
      dueDate: f.date,
    };
    const paid = await postEntry(c, payment);
    assert.ok(paid?.id);
    const retry = await postEntry(c, payment);
    assert.equal(retry?.id, paid.id);
    await assert.rejects(() =>
      postEntry(c, { ...payment, amountPaise: -6006n }),
    );
    await settleResident(c, f.residentId);
    let ledger = await residentLedger(c, f.residentId);
    assert.equal(ledger.balance, '90.30');
    assert.equal(
      ledger.entries.find((e) => e.id === old.id)?.openAmount,
      '40.05',
    );
    assert.equal(
      ledger.entries.find((e) => e.id === second.id)?.openAmount,
      '50.25',
    );
    await postEntry(c, {
      ...base,
      kind: 'PAYMENT',
      sourceKey: 'payment:second',
      amountPaise: -10000n,
      dueDate: f.date,
    });
    await settleResident(c, f.residentId);
    await settleResident(c, f.residentId);
    ledger = await residentLedger(c, f.residentId);
    assert.equal(ledger.balance, '-9.70');
    assert.equal(ledger.credit, '9.70');
    assert.equal(ledger.entries.filter((e) => e.kind === 'PAYMENT').length, 2);
  });
  await assert.rejects(
    () =>
      withTenant(api.pool, f.agencyId, (c) =>
        c.query('UPDATE daybook.ledger_entries SET amount_paise=0'),
      ),
    { code: '42501' },
  );
});
test('ledger entries and settlements remain scoped and cannot over-allocate a credit', async () => {
  const f = await fixture(),
    other = await fixture();
  let debit = '',
    credit = '';
  await withTenant(api.pool, f.agencyId, async (c) => {
    const base = {
      agencyId: f.agencyId,
      residentId: f.residentId,
      date: f.date,
      dueDate: f.date,
      description: 'Bounded settlement',
    };
    debit = (await postEntry(c, {
      ...base,
      kind: 'OPENING',
      sourceKey: 'debit',
      amountPaise: 100n,
    }))!.id;
    credit = (await postEntry(c, {
      ...base,
      kind: 'PAYMENT',
      sourceKey: 'credit',
      amountPaise: -50n,
    }))!.id;
    await settleResident(c, f.residentId);
  });
  await assert.rejects(
    () =>
      withTenant(api.pool, f.agencyId, (c) =>
        c.query(
          'INSERT INTO daybook.ledger_settlements(id,agency_id,debit_entry_id,credit_entry_id,amount_paise) VALUES(gen_random_uuid(),$1,$2,$3,1)',
          [f.agencyId, debit, credit],
        ),
      ),
    { code: '23514' },
  );
  const empty = await withTenant(api.pool, other.agencyId, (c) =>
    residentLedger(c, f.residentId),
  );
  assert.deepEqual(empty, { balance: '0.00', credit: '0.00', entries: [] });
});

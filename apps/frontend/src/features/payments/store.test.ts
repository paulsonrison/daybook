import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test('late successes and definitive failures cannot erase a newer original operation after navigation or scope changes', async () => {
  const values = new Map<string, string>();
  const previousAdapter = axios.defaults.adapter;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'sessionStorage',
  );
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { search: '' } },
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
  const agency = '00000000-0000-4000-8000-000000000001';
  const otherAgency = '00000000-0000-4000-8000-000000000002';
  const resident = '00000000-0000-4000-8000-000000000003';
  const a = '00000000-0000-4000-8000-000000000004';
  const b = '00000000-0000-4000-8000-000000000005';
  const key = `daybook:financial-operation:${agency}`;
  let active = {
    firstStarted: deferred(),
    firstDone: deferred(),
    secondStarted: deferred(),
    secondDone: deferred(),
    calls: 0,
    rejection: false,
  };
  axios.defaults.adapter = async (config) => {
    const body = JSON.parse(config.data as string);
    let data: unknown;
    if (body.query.startsWith('mutation')) {
      if (body.variables.input.requestId === a) {
        active.calls++;
        if (active.calls === 1) {
          active.firstStarted.resolve();
          await active.firstDone.promise;
        }
        if (active.rejection)
          return {
            config,
            headers: {},
            status: 200,
            statusText: 'OK',
            data: { errors: [{ message: 'Synthetic definitive rejection' }] },
          };
        data = { saveContactPreference: { version: 1 } };
      } else {
        assert.equal(body.variables.input.requestId, b);
        active.secondStarted.resolve();
        await active.secondDone.promise;
        data = { saveCommunicationSettings: { version: 1 } };
      }
    } else if (body.query.includes('creditRiskSummary'))
      data = {
        me: { agencyId: agency, agency: { name: 'Synthetic agency' } },
        residents: [
          {
            id: resident,
            name: 'Synthetic resident',
            code: 'RES-1',
            status: 'ACTIVE',
            depositBalance: '0.00',
            version: 1,
            routeId: resident,
            dropOrder: 1,
          },
        ],
        routes: [],
        staff: [],
        deliveryMetrics: { today: '2026-11-14' },
        creditRiskSummary: { accounts: [] },
        creditPolicy: {
          maxOverdueAmount: null,
          maxOverdueDays: 60,
          enabled: true,
          version: 0,
        },
        collectionSettings: { upiId: null, payeeName: null, version: 0 },
      };
    else
      data = {
        payments: [],
        invoices: [],
        residentLedger: { balance: '0.00', credit: '0.00', entries: [] },
        clearanceForResident: null,
      };
    return {
      config,
      headers: {},
      status: 200,
      statusText: 'OK',
      data: { data },
    };
  };
  try {
    const path = './store.ts';
    const { PaymentsStore } = await import(path);
    for (const rejection of [false, true])
      for (const mode of ['disposed', 'superseded', 'agency-changed']) {
        values.clear();
        active = {
          firstStarted: deferred(),
          firstDone: deferred(),
          secondStarted: deferred(),
          secondDone: deferred(),
          calls: 0,
          rejection,
        };
        const oldStore = new PaymentsStore();
        await oldStore.load();
        const first = oldStore.execute(
          'contactPreference',
          {
            requestId: a,
            residentId: resident,
            version: 0,
            locale: 'en',
            whatsapp: false,
            sms: false,
            confirmedConsent: false,
            evidence: 'Synthetic preference update',
          },
          resident,
        );
        await active.firstStarted.promise;
        if (mode === 'disposed') oldStore.dispose();
        const current = new PaymentsStore();
        await current.load();
        assert.equal(current.pending.input.requestId, a);
        await current.retryOriginal();
        assert.equal(current.pending, null);
        const second = current.execute(
          'communicationSettings',
          {
            requestId: b,
            version: 0,
            remindersEnabled: false,
            frequencyDays: 7,
            cooldownHours: 24,
            reminderChannel: 'SMS',
          },
          '',
        );
        await active.secondStarted.promise;
        assert.equal(JSON.parse(values.get(key)!).input.requestId, b);
        if (mode === 'agency-changed') {
          oldStore.agencyId = otherAgency;
          values.set(
            `daybook:financial-operation:${otherAgency}`,
            JSON.stringify({
              kind: 'communicationSettings',
              input: { requestId: b },
              residentId: '',
            }),
          );
        }
        active.firstDone.resolve();
        await first;
        assert.equal(
          JSON.parse(values.get(key) ?? 'null')?.input.requestId,
          b,
          `${mode}, rejection=${rejection}: operation B must retain its original recovery record`,
        );
        if (mode === 'agency-changed')
          assert.ok(values.has(`daybook:financial-operation:${otherAgency}`));
        active.secondDone.resolve();
        await second;
        assert.equal(values.has(key), false);
        current.dispose();
        oldStore.dispose();
      }
  } finally {
    active.firstDone.resolve();
    active.secondDone.resolve();
    axios.defaults.adapter = previousAdapter;
    if (previousWindow)
      Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage)
      Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

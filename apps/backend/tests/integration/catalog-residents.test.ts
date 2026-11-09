import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
test('deactivating and editing a resident preserves their deposit and delivery link', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const input = {
    requestId: randomUUID(),
    name: 'Lifecycle',
    address: '21 Lotus Lane',
    phone: '9876543210',
    sector: 'Lotus Lane',
    routeId: route.id,
    dropOrder: 1,
    openingDeposit: '250.50',
  };
  const original = (await api.query(cookie, residentMutation, { input })).data
    .saveResident;
  const result = await api.query(cookie, residentMutation, {
    input: {
      ...input,
      id: original.id,
      version: original.version,
      name: 'Lifecycle Updated',
      address: '21A Lotus Lane',
      status: 'INACTIVE',
      openingDeposit: undefined,
    },
  });
  assert.equal(
    result.data?.saveResident.status,
    'INACTIVE',
    JSON.stringify(result),
  );
  assert.equal(result.data.saveResident.depositBalance, '250.50');
  const links = (
    await api.query(cookie, '{routes{stops{residentId label door}}}')
  ).data.routes[0].stops;
  assert.deepEqual(links, [
    {
      residentId: original.id,
      label: 'Lifecycle Updated',
      door: '21A Lotus Lane',
    },
  ]);
});
const publicationMutation =
  'mutation($input:PublicationInput!){savePublication(input:$input){id name edition kind language dispatch frequency publishingDays weekdayPrice weekendPrice procurementNetCost version active}}';
const residentMutation =
  'mutation($input:ResidentInput!){saveResident(input:$input){id code name address phone sector routeId dropOrder status depositBalance version}}';
const depositMutation =
  'mutation($input:DepositInput!){recordDeposit(input:$input){id residentId amount balance}}';
test('route reorder invalidates stale resident edits and territory changes preserve resident sectors', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const input = {
    requestId: randomUUID(),
    name: 'Versioned',
    address: '19 Lotus Lane',
    phone: '9876543210',
    sector: 'Lotus Lane',
    routeId: route.id,
    dropOrder: 1,
  };
  const person = (await api.query(cookie, residentMutation, { input })).data
    .saveResident;
  const current = (
    await api.query(
      cookie,
      '{routes{id code name territoryId version stops{id label door sequence}} territories{id name locality pinCodes sectors version}}',
    )
  ).data;
  const base = current.routes[0];
  const moved = await api.query(
    cookie,
    'mutation($input:RouteInput!){saveRoute(input:$input){id version}}',
    {
      input: {
        ...base,
        stops: base.stops.map((s: object) => ({ ...s, sequence: 2 })),
      },
    },
  );
  assert.ok(moved.data?.saveRoute, JSON.stringify(moved));
  const stale = await api.query(cookie, residentMutation, {
    input: { ...input, id: person.id, version: person.version },
  });
  assert.equal(stale.errors?.[0].extensions.code, 'CONFLICT');
  const other = await api.query(
    cookie,
    'mutation{saveTerritory(input:{name:"Other",locality:"Other",pinCodes:["682030"],sectors:["Other Lane"]}){id}}',
  );
  const changed = await api.query(
    cookie,
    'mutation($input:RouteInput!){saveRoute(input:$input){id}}',
    {
      input: {
        ...base,
        stops: undefined,
        version: moved.data.saveRoute.version,
        territoryId: other.data.saveTerritory.id,
      },
    },
  );
  assert.equal(changed.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const territory = current.territories[0];
  const removed = await api.query(
    cookie,
    'mutation($input:TerritoryInput!){saveTerritory(input:$input){id}}',
    { input: { ...territory, sectors: ['Other Lane'] } },
  );
  assert.equal(removed.errors?.[0].extensions.code, 'BAD_USER_INPUT');
});
test('catalog retains exact retail/procurement prices and regional/evening calendars', async () => {
  const cookie = await api.agency();
  const first = await api.query(cookie, publicationMutation, {
    input: {
      name: 'Regional Weekly',
      edition: 'Kochi',
      kind: 'PERIODICAL',
      language: 'Malayalam',
      dispatch: 'EVENING',
      frequency: 'WEEKLY',
      publishingDays: [3],
      weekdayPrice: '8.15',
      weekendPrice: '12.25',
      procurementNetCost: '5.05',
    },
  });
  assert.ok(first.data?.savePublication, JSON.stringify(first));
  assert.deepEqual(
    { ...first.data.savePublication, id: undefined, version: undefined },
    {
      id: undefined,
      version: undefined,
      name: 'Regional Weekly',
      edition: 'Kochi',
      kind: 'PERIODICAL',
      language: 'Malayalam',
      dispatch: 'EVENING',
      frequency: 'WEEKLY',
      publishingDays: [3],
      weekdayPrice: '8.15',
      weekendPrice: '12.25',
      procurementNetCost: '5.05',
      active: true,
    },
  );
  const invalid = await api.query(cookie, publicationMutation, {
    input: {
      name: 'Invalid',
      edition: 'Kochi',
      kind: 'NEWSPAPER',
      language: 'English',
      dispatch: 'MORNING',
      frequency: 'DAILY',
      publishingDays: [8],
      weekdayPrice: '-1',
      weekendPrice: '1.005',
    },
  });
  assert.equal(invalid.errors?.[0].extensions.code, 'BAD_USER_INPUT');
});
test('resident creation maps ordered route stops and opening deposit exactly once on retry', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    requestId = randomUUID();
  const input = {
    requestId,
    name: 'Anitha',
    address: '12, Lotus Lane',
    phone: '9876543210',
    sector: 'Lotus Lane',
    routeId: route.id,
    dropOrder: 1,
    openingDeposit: '500.25',
  };
  const first = await api.query(cookie, residentMutation, { input });
  assert.ok(first.data?.saveResident, JSON.stringify(first));
  const resident = first.data.saveResident;
  assert.equal(resident.depositBalance, '500.25');
  const retry = await api.query(cookie, residentMutation, { input });
  assert.equal(retry.data.saveResident.id, resident.id);
  assert.equal(retry.data.saveResident.depositBalance, '500.25');
  const changed = await api.query(cookie, residentMutation, {
    input: { ...input, name: 'Different' },
  });
  assert.equal(changed.errors?.[0].extensions.code, 'CONFLICT');
  const result = await api.query(
    cookie,
    '{routes{id version stops{label door sequence}} residents{id name}}',
  );
  assert.equal(result.data.routes[0].version, route.version + 1);
  assert.deepEqual(result.data.routes[0].stops, [
    { label: 'Anitha', door: '12, Lotus Lane', sequence: 1 },
  ]);
  assert.equal(result.data.residents.length, 1);
});
test('deposit receipt is immutable and retry-safe, including amounts above floating-point precision', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const person = await api.query(cookie, residentMutation, {
    input: {
      requestId: randomUUID(),
      name: 'Exact Deposit',
      address: '14, Lotus Lane',
      phone: '9876543210',
      sector: 'Lotus Lane',
      routeId: route.id,
      dropOrder: 1,
    },
  });
  assert.ok(person.data?.saveResident, JSON.stringify(person));
  const residentId = person.data.saveResident.id;
  const input = {
    residentId,
    requestId: randomUUID(),
    amount: '90071992547409.93',
  };
  const first = await api.query(cookie, depositMutation, { input });
  assert.equal(
    first.data?.recordDeposit.balance,
    '90071992547409.93',
    JSON.stringify(first),
  );
  const second = await api.query(cookie, depositMutation, { input });
  assert.equal(second.data.recordDeposit.id, first.data.recordDeposit.id);
  assert.equal(second.data.recordDeposit.balance, '90071992547409.93');
  const bad = await api.query(cookie, depositMutation, {
    input: { ...input, requestId: randomUUID(), amount: '-1' },
  });
  assert.equal(bad.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  await assert.rejects(
    api.pool.query('UPDATE daybook.deposit_entries SET amount_paise=0'),
    /permission denied/,
  );
});
test('resident route links stay tenant-scoped and inactive routes cannot receive active residents', async () => {
  const first = await api.agency(),
    second = await api.agency(),
    route = await api.route(first);
  const input = {
    requestId: randomUUID(),
    name: 'Denied',
    address: '12, Lotus Lane',
    phone: '9876543210',
    sector: 'Lotus Lane',
    routeId: route.id,
    dropOrder: 1,
  };
  const foreign = await api.query(second, residentMutation, { input });
  assert.equal(foreign.errors?.[0].extensions.code, 'NOT_FOUND');
  const archive = await api.query(
    first,
    'mutation($id:ID!,$version:Int!,$territory:ID!){saveRoute(input:{id:$id,version:$version,code:"R01",name:"Lotus",territoryId:$territory,active:false}){id}}',
    {
      id: route.id,
      version: route.version,
      territory: (await api.query(first, '{territories{id}}')).data
        .territories[0].id,
    },
  );
  assert.ok(archive.data?.saveRoute);
  const inactive = await api.query(first, residentMutation, { input });
  assert.equal(inactive.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const empty = await api.query(second, '{residents{id} publications{id}}');
  assert.deepEqual(empty.data, { residents: [], publications: [] });
});

test('route editing cannot orphan residents or deactivate their active delivery route', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const person = await api.query(cookie, residentMutation, {
    input: {
      requestId: randomUUID(),
      name: 'Linked',
      address: '18, Lotus Lane',
      phone: '9876543210',
      sector: 'Lotus Lane',
      routeId: route.id,
      dropOrder: 1,
    },
  });
  assert.ok(person.data?.saveResident);
  const current = (
    await api.query(
      cookie,
      '{routes{id code name territoryId version stops{id label door sequence}}}',
    )
  ).data.routes[0];
  const base = {
    id: current.id,
    version: current.version,
    code: current.code,
    name: current.name,
    territoryId: current.territoryId,
  };
  const removed = await api.query(
    cookie,
    'mutation($input:RouteInput!){saveRoute(input:$input){id}}',
    { input: { ...base, stops: [] } },
  );
  assert.equal(removed.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const inactive = await api.query(
    cookie,
    'mutation($input:RouteInput!){saveRoute(input:$input){id}}',
    { input: { ...base, active: false } },
  );
  assert.equal(inactive.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const changed = await api.query(
    cookie,
    'mutation($input:RouteInput!){saveRoute(input:$input){id}}',
    {
      input: {
        ...base,
        stops: current.stops.map(
          (s: { id: string; door: string; sequence: number }) => ({
            ...s,
            label: 'Unrelated name',
          }),
        ),
      },
    },
  );
  assert.equal(changed.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const preserved = await api.query(
    cookie,
    '{residents{name dropOrder} routes{active stops{label}}}',
  );
  assert.deepEqual(preserved.data.residents, [
    { name: 'Linked', dropOrder: 1 },
  ]);
  assert.equal(preserved.data.routes[0].active, true);
});

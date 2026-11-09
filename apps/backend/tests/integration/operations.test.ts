import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../../src/app.js';

const pool = new pg.Pool({
  connectionString: process.env.TEST_RUNTIME_DATABASE_URL,
  max: 4,
});
after(() => pool.end());
const app = createApp({ pool, databaseReady: async () => true });
async function agency() {
  const response = await app.fetch(
    new Request('http://localhost/auth/register', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agencyName: 'Operations Test',
        name: 'Owner',
        email: `${randomUUID()}@example.test`,
        password: 'Test operation password 123',
      }),
    }),
  );
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')!;
}
async function query(
  cookie: string,
  query: string,
  variables: Record<string, unknown> = {},
  origin = 'http://localhost:3000',
) {
  const response = await app.fetch(
    new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    }),
  );
  return response.json();
}
const territoryMutation =
  'mutation($input:TerritoryInput!){saveTerritory(input:$input){id name locality pinCodes sectors version active}}';
const staffMutation =
  'mutation($input:StaffInput!){saveStaff(input:$input){id name staffCode phone status version assignedSectors}}';
const routeMutation =
  'mutation($input:RouteInput!){saveRoute(input:$input){id code name territoryId staffId staffName version active stops{id label door sequence}}}';
async function setup(cookie: string) {
  const territory = await query(cookie, territoryMutation, {
    input: {
      name: 'Central area',
      locality: 'Kochi',
      pinCodes: ['682020'],
      sectors: ['Lotus Lane'],
    },
  });
  assert.ok(territory.data?.saveTerritory, JSON.stringify(territory));
  const staff = await query(cookie, staffMutation, {
    input: {
      name: 'Biju',
      staffCode: 'DB01',
      phone: '9876543210',
      status: 'ACTIVE',
    },
  });
  assert.ok(staff.data?.saveStaff, JSON.stringify(staff));
  return {
    territory: territory.data.saveTerritory,
    staff: staff.data.saveStaff,
  };
}
test('workspace configuration requires authentication', async () => {
  const body = await query('', '{ territories{id} }');
  assert.equal(body.errors?.[0].extensions.code, 'UNAUTHENTICATED');
});
test('territory canonical overlaps require an explicit authorized reason and create an audit event', async () => {
  const cookie = await agency();
  const first = await query(cookie, territoryMutation, {
    input: {
      name: 'Central',
      locality: ' Kochi ',
      pinCodes: ['682020'],
      sectors: [' Lotus  Lane '],
    },
  });
  assert.ok(first.data?.saveTerritory, JSON.stringify(first));
  const duplicate = await query(cookie, territoryMutation, {
    input: {
      name: 'Duplicate',
      locality: 'KOCHI',
      pinCodes: ['682020'],
      sectors: ['lotus lane'],
    },
  });
  assert.equal(duplicate.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const override = await query(cookie, territoryMutation, {
    input: {
      name: 'Shared area',
      locality: 'KOCHI',
      pinCodes: ['682020'],
      sectors: ['lotus lane'],
      overlapReason: 'Owner approved shared boundary',
    },
  });
  assert.ok(override.data?.saveTerritory, JSON.stringify(override));
  const events = await query(cookie, '{auditEvents{action entityType}}');
  assert.ok(
    events.data.auditEvents.some(
      (e: { action: string }) => e.action === 'territory.overlap_authorized',
    ),
  );
});
test('staff and routes preserve ordered stops and stale updates cannot overwrite newer data', async () => {
  const cookie = await agency(),
    { territory, staff } = await setup(cookie);
  assert.equal(staff.phone, '+919876543210');
  const input = {
    code: 'R01',
    name: 'Morning route',
    territoryId: territory.id,
    staffId: staff.id,
    active: true,
    stops: [
      { label: 'Leela', door: '14', sequence: 2 },
      { label: 'Anitha', door: '12', sequence: 1 },
    ],
  };
  const created = await query(cookie, routeMutation, { input });
  assert.ok(created.data?.saveRoute, JSON.stringify(created));
  const route = created.data.saveRoute;
  assert.deepEqual(
    route.stops.map((s: { door: string }) => s.door),
    ['12', '14'],
  );
  const [one, two] = await Promise.all(
    ['Updated A', 'Updated B'].map((name) =>
      query(cookie, routeMutation, {
        input: { ...input, id: route.id, version: route.version, name },
      }),
    ),
  );
  assert.equal(
    [one, two].filter((b) => b.data?.saveRoute?.version === 2).length,
    1,
  );
  assert.equal(
    [one, two].filter((b) => b.errors?.[0].extensions.code === 'CONFLICT')
      .length,
    1,
  );
  const summary = await query(
    cookie,
    '{operationsSummary{territories activeStaff activeRoutes} staff{assignedSectors}}',
  );
  assert.deepEqual(summary.data.operationsSummary, {
    territories: 1,
    activeStaff: 1,
    activeRoutes: 1,
  });
  assert.deepEqual(summary.data.staff[0].assignedSectors, ['Lotus Lane']);
});
test('inactive staff cannot be assigned and assigned staff must be reassigned before deactivation', async () => {
  const cookie = await agency(),
    { territory, staff } = await setup(cookie);
  const leave = await query(cookie, staffMutation, {
    input: {
      id: staff.id,
      version: staff.version,
      name: staff.name,
      staffCode: staff.staffCode,
      phone: staff.phone,
      status: 'INACTIVE',
    },
  });
  assert.equal(leave.data.saveStaff.status, 'INACTIVE');
  const denied = await query(cookie, routeMutation, {
    input: {
      code: 'R01',
      name: 'Route',
      territoryId: territory.id,
      staffId: staff.id,
      stops: [],
    },
  });
  assert.equal(denied.errors?.[0].extensions.code, 'BAD_USER_INPUT');
  const restored = await query(cookie, staffMutation, {
    input: {
      id: staff.id,
      version: leave.data.saveStaff.version,
      name: staff.name,
      staffCode: staff.staffCode,
      phone: staff.phone,
      status: 'ACTIVE',
    },
  });
  const route = await query(cookie, routeMutation, {
    input: {
      code: 'R01',
      name: 'Route',
      territoryId: territory.id,
      staffId: staff.id,
      stops: [],
    },
  });
  assert.ok(route.data?.saveRoute);
  const blocked = await query(cookie, staffMutation, {
    input: {
      id: staff.id,
      version: restored.data.saveStaff.version,
      name: staff.name,
      staffCode: staff.staffCode,
      phone: staff.phone,
      status: 'INACTIVE',
    },
  });
  assert.equal(blocked.errors?.[0].extensions.code, 'BAD_USER_INPUT');
});
test('foreign agency references and untrusted mutation origins are rejected', async () => {
  const first = await agency(),
    second = await agency(),
    { territory, staff } = await setup(first);
  const foreign = await query(second, routeMutation, {
    input: {
      code: 'R01',
      name: 'Forged',
      territoryId: territory.id,
      staffId: staff.id,
      stops: [],
    },
  });
  assert.equal(foreign.errors?.[0].extensions.code, 'NOT_FOUND');
  const lists = await query(
    second,
    '{territories{id} staff{id} routes{id} operationsSummary{territories activeStaff activeRoutes}}',
  );
  assert.deepEqual(lists.data, {
    territories: [],
    staff: [],
    routes: [],
    operationsSummary: { territories: 0, activeStaff: 0, activeRoutes: 0 },
  });
  const denied = await query(
    first,
    territoryMutation,
    {
      input: {
        name: 'Denied',
        locality: 'Kochi',
        pinCodes: ['682020'],
        sectors: ['Other'],
      },
    },
    'https://untrusted.example',
  );
  assert.equal(denied.errors?.[0].extensions.code, 'FORBIDDEN');
});
test('editing inactive territory or route metadata does not silently reactivate it', async () => {
  const cookie = await agency();
  const first = await query(cookie, territoryMutation, {
    input: {
      name: 'Archived',
      locality: 'Kochi',
      pinCodes: ['682020'],
      sectors: ['Archived sector'],
      active: false,
    },
  });
  const t = first.data.saveTerritory;
  const renamed = await query(cookie, territoryMutation, {
    input: {
      id: t.id,
      version: t.version,
      name: 'Archived renamed',
      locality: t.locality,
      pinCodes: t.pinCodes,
      sectors: t.sectors,
    },
  });
  assert.equal(renamed.data?.saveTerritory.active, false);
  const { territory, staff } = await setup(cookie);
  const created = await query(cookie, routeMutation, {
    input: {
      code: 'R01',
      name: 'Archived route',
      territoryId: territory.id,
      staffId: staff.id,
      active: false,
      stops: [],
    },
  });
  const route = created.data.saveRoute;
  const updated = await query(cookie, routeMutation, {
    input: {
      id: route.id,
      version: route.version,
      code: route.code,
      name: 'Archived rename',
      territoryId: territory.id,
      staffId: staff.id,
    },
  });
  assert.equal(updated.data?.saveRoute.active, false);
});

test('routes may be deactivated with absent staff and archived metadata remains editable', async () => {
  const cookie = await agency(),
    { territory, staff } = await setup(cookie);
  const created = await query(cookie, routeMutation, {
    input: {
      code: 'R01',
      name: 'Regular route',
      territoryId: territory.id,
      staffId: staff.id,
      stops: [],
    },
  });
  const route = created.data.saveRoute;
  const absent = await query(cookie, staffMutation, {
    input: {
      id: staff.id,
      version: staff.version,
      name: staff.name,
      staffCode: staff.staffCode,
      phone: staff.phone,
      status: 'ON_LEAVE',
    },
  });
  assert.ok(absent.data?.saveStaff);
  const stopped = await query(cookie, routeMutation, {
    input: {
      id: route.id,
      version: route.version,
      code: route.code,
      name: route.name,
      territoryId: territory.id,
      staffId: staff.id,
      active: false,
    },
  });
  assert.equal(stopped.data?.saveRoute.active, false, JSON.stringify(stopped));
  const inactiveTerritory = await query(cookie, territoryMutation, {
    input: {
      id: territory.id,
      version: territory.version,
      name: territory.name,
      locality: territory.locality,
      pinCodes: territory.pinCodes,
      sectors: territory.sectors,
      active: false,
    },
  });
  assert.ok(inactiveTerritory.data?.saveTerritory);
  const renamed = await query(cookie, routeMutation, {
    input: {
      id: route.id,
      version: stopped.data.saveRoute.version,
      code: route.code,
      name: 'Archived edited',
      territoryId: territory.id,
      staffId: staff.id,
    },
  });
  assert.equal(
    renamed.data?.saveRoute.name,
    'Archived edited',
    JSON.stringify(renamed),
  );
  assert.equal(renamed.data.saveRoute.active, false);
});

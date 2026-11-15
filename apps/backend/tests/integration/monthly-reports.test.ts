import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { withTenant } from '../../src/db/tenant.js';
import { testApi } from './support.js';
const api = testApi();
after(() => api.pool.end());
test('agency report preparation is immutable and idempotent; genuine XLSX downloads require the same tenant session', async () => {
  const cookie = await api.agency(),
    route = await api.route(cookie);
  const date = (await api.query(cookie, '{deliveryMetrics{today}}')).data
    .deliveryMetrics.today;
  const agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: '=Original Customer',
          address: '12 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  async function debit(amount: string) {
    const result = await api.query(
      cookie,
      'mutation($input:AccountAdjustmentInput!){postAdjustment(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: resident.id,
          direction: 'DEBIT',
          category: 'OPENING',
          amount,
          date,
          reason: 'Recorded opening report balance',
        },
      },
    );
    assert.ok(!result.errors, JSON.stringify(result));
  }
  await debit('20.05');
  const input = {
    requestId: randomUUID(),
    kind: 'OPERATIONS',
    month: date.slice(0, 7),
    locale: 'ml',
  };
  const mutation =
    'mutation($input:ExportReportInput!){exportReport(input:$input){id kind month locale snapshotHash createdAt}}';
  const prepared = await api.query(cookie, mutation, { input });
  assert.ok(prepared.data?.exportReport, JSON.stringify(prepared));
  const report = prepared.data.exportReport;
  assert.match(report.snapshotHash, /^[a-f0-9]{64}$/);
  const snapshot = await withTenant(
    api.pool,
    agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT snapshot FROM daybook.agency_reports WHERE id=$1',
          [report.id],
        )
      ).rows[0].snapshot,
  );
  assert.equal(snapshot.locale, 'ml');
  assert.ok(snapshot.sections.length > 0);
  await debit('10.00');
  const replay = await api.query(cookie, mutation, { input });
  assert.deepEqual(replay.data?.exportReport, report);
  const generated = await api.query(
    cookie,
    'mutation($input:GenerateReportInput!){generateReport(input:$input){id artifacts{format status sha256 byteLength}}}',
    { input: { requestId: randomUUID(), reportId: report.id, format: 'XLSX' } },
  );
  assert.ok(generated.data?.generateReport, JSON.stringify(generated));
  assert.equal(generated.data.generateReport.artifacts[0].status, 'READY');
  const response = await api.fetch(
    new Request(`http://localhost/reports/owner/${report.id}/xlsx`, {
      headers: { cookie },
    }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /spreadsheetml/);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const xml = Object.values(files).map(strFromU8).join('\n');
  assert.match(xml, /20.05/);
  assert.doesNotMatch(xml, /30.05/);
  assert.match(xml, /മാസ/);
  assert.doesNotMatch(xml, /<f(?:[ >])/);
  const unauthenticated = await api.fetch(
    new Request(`http://localhost/reports/owner/${report.id}/xlsx`),
  );
  assert.equal(unauthenticated.status, 401);
  const foreign = await api.agency();
  const denied = await api.fetch(
    new Request(`http://localhost/reports/owner/${report.id}/xlsx`, {
      headers: { cookie: foreign },
    }),
  );
  assert.equal(denied.status, 404);
  const hidden = await api.query(
    foreign,
    'query($id:ID!){agencyReport(id:$id){id}}',
    { id: report.id },
  );
  assert.equal(hidden.errors?.[0].extensions.code, 'NOT_FOUND');
  await assert.rejects(
    withTenant(api.pool, agencyId, (c) =>
      c.query("UPDATE daybook.agency_reports SET snapshot='{}' WHERE id=$1", [
        report.id,
      ]),
    ),
  );
});

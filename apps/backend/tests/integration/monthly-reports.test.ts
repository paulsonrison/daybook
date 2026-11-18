import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { withTenant } from '../../src/db/tenant.js';
import { reserveDocumentRenderer } from '../../src/modules/documents/engine.js';
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
  const xml = Object.values(files)
    .map((file) => strFromU8(file, false))
    .join('\n');
  assert.match(xml, /20.05/);
  assert.doesNotMatch(xml, /30.05/);
  assert.match(xml, /മാസ/);
  assert.doesNotMatch(xml, /<f(?:[ >])/);
  const head = await api.fetch(
    new Request(`http://localhost/reports/owner/${report.id}/xlsx`, {
      method: 'HEAD',
      headers: { cookie },
    }),
  );
  assert.equal(head.status, 200);
  assert.equal(
    head.headers.get('content-length'),
    response.headers.get('content-length'),
  );
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const pdfGenerated = await api.query(
    cookie,
    'mutation($input:GenerateReportInput!){generateReport(input:$input){id artifacts{format status byteLength}}}',
    {
      input: {
        requestId: randomUUID(),
        reportId: report.id,
        format: 'PDF',
      },
    },
  );
  assert.ok(pdfGenerated.data?.generateReport, JSON.stringify(pdfGenerated));
  assert.equal(pdfGenerated.data.generateReport.artifacts[0].status, 'READY');
  const pdfResponse = await api.fetch(
    new Request(`http://localhost/reports/owner/${report.id}/pdf`, {
      headers: { cookie },
    }),
  );
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get('content-type')!, /application\/pdf/);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length >= 100 && pdf.length <= 10_485_760);
  assert.match(
    pdf.toString('latin1'),
    /NotoSansMalayalam|Noto Sans Malayalam/i,
  );
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
  const bankReceipt = await api.query(
    cookie,
    'mutation($input:PaymentInput!){recordPayment(input:$input){status method}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        purpose: 'ACCOUNT',
        method: 'BANK',
        amount: '5.00',
        date,
        reference: 'REPORTBANK123',
        confirmReceived: true,
        confirmationNote: 'Synthetic report test receipt',
      },
    },
  );
  assert.equal(bankReceipt.data?.recordPayment.method, 'BANK');
  const sales = await api.query(cookie, mutation, {
    input: { ...input, requestId: randomUUID(), kind: 'SALES', locale: 'hi' },
  });
  assert.ok(sales.data?.exportReport, JSON.stringify(sales));
  const salesSnapshot = await withTenant(
    api.pool,
    agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT snapshot FROM daybook.agency_reports WHERE id=$1',
          [sales.data.exportReport.id],
        )
      ).rows[0].snapshot,
  );
  assert.ok(
    salesSnapshot.sections.some(
      (section: { title: string }) => section.title === 'दर्ज रिफंड',
    ),
  );
  assert.match(salesSnapshot.notes[0], /पुराने बिल/);
  assert.ok(
    salesSnapshot.sections[1].rows.some((row: string[]) =>
      row.includes('बैंक हस्तांतरण'),
    ),
  );
  const tax = await api.query(cookie, mutation, {
    input: { ...input, requestId: randomUUID(), kind: 'TAX', locale: 'hi' },
  });
  assert.ok(tax.data?.exportReport, JSON.stringify(tax));
  const taxSnapshot = await withTenant(
    api.pool,
    agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT snapshot FROM daybook.agency_reports WHERE id=$1',
          [tax.data.exportReport.id],
        )
      ).rows[0].snapshot,
  );
  assert.equal(taxSnapshot.sections[0].rows.length, 0);
  assert.equal(taxSnapshot.notes.length, 2);
  assert.match(taxSnapshot.notes[1], /विज्ञापन बिल/);
  await assert.rejects(
    withTenant(api.pool, agencyId, (c) =>
      c.query("UPDATE daybook.agency_reports SET snapshot='{}' WHERE id=$1", [
        report.id,
      ]),
    ),
  );
});

test('PDF renderer contention does not consume report attempts or the retry request', async () => {
  const cookie = await api.agency();
  const date = (await api.query(cookie, '{deliveryMetrics{today}}')).data
    .deliveryMetrics.today;
  const prepared = await api.query(
    cookie,
    'mutation($input:ExportReportInput!){exportReport(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        kind: 'OPERATIONS',
        month: date.slice(0, 7),
        locale: 'en',
      },
    },
  );
  const reportId = prepared.data.exportReport.id;
  const held = [reserveDocumentRenderer(), reserveDocumentRenderer()];
  assert.ok(held.every(Boolean));
  const input = { requestId: randomUUID(), reportId, format: 'PDF' };
  try {
    const busy = await api.query(
      cookie,
      'mutation($input:GenerateReportInput!){generateReport(input:$input){id}}',
      { input },
    );
    assert.equal(busy.errors?.[0].extensions.code, 'CONFLICT');
    const agencyId = (await api.query(cookie, '{me{agencyId}}')).data.me
      .agencyId;
    const artifact = await withTenant(
      api.pool,
      agencyId,
      async (c) =>
        (
          await c.query(
            'SELECT status,attempts FROM daybook.report_artifacts WHERE report_id=$1 AND format=$2',
            [reportId, 'PDF'],
          )
        ).rows[0],
    );
    assert.equal(artifact, undefined);
  } finally {
    held.forEach((reservation) => reservation?.release());
  }
  const retried = await api.query(
    cookie,
    'mutation($input:GenerateReportInput!){generateReport(input:$input){id artifacts{status}}}',
    { input },
  );
  assert.ok(retried.data?.generateReport, JSON.stringify(retried));
  assert.equal(retried.data.generateReport.artifacts[0].status, 'READY');
});

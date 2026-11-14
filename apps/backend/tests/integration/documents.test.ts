import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
import {
  generateOneDocument,
  runDocumentJobs,
} from '../../src/modules/documents/service.js';
import { renderFinancialDocument } from '@daybook/ui/documents';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
process.env.DOCUMENT_LINK_SECRET =
  'synthetic-document-link-key-not-for-live-use-0123456789';
process.env.PUBLIC_APP_ORIGIN = 'https://documents.example.test';
const api = testApi();
after(() => api.pool.end());
test('invoice QR snapshots survive later payments while refund and payroll documents use their own financial sources', async () => {
  const f = await source('DEPOSIT');
  async function run(query: string, variables: Record<string, unknown> = {}) {
    const r = await api.query(f.cookie, query, variables);
    assert.ok(!r.errors, JSON.stringify(r));
    return r.data;
  }
  await run(
    'mutation{saveBillingPolicy(input:{noTaxConfirmed:true}){version}}',
  );
  const publication = (
    await run(
      'mutation{savePublication(input:{name:"Document Daily",edition:"Kochi",kind:NEWSPAPER,language:"Malayalam",dispatch:MORNING,frequency:DAILY,publishingDays:[0,1,2,3,4,5,6],weekdayPrice:"7",weekendPrice:"7"}){id}}',
    )
  ).savePublication;
  await run(
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: f.resident.id,
        publicationId: publication.id,
        cadence: 'DAILY',
        startDate: f.today,
        weekdays: [],
        quantity: 1,
      },
    },
  );
  await run(
    'mutation($date:String!){markScheduledDeliveries(date:$date){total}}',
    { date: f.today },
  );
  const bill = {
    residentId: f.resident.id,
    periodMode: 'CUSTOM',
    periods: [{ from: f.today, to: f.today }],
  };
  const preview = (
    await run(
      'query($input:BillInput!){previewBill(input:$input){fingerprint}}',
      { input: bill },
    )
  ).previewBill;
  const invoice = (
    await run(
      'mutation($input:InvoiceInput!){generateInvoice(input:$input){id version}}',
      {
        input: {
          ...bill,
          requestId: randomUUID(),
          previewFingerprint: preview.fingerprint,
        },
      },
    )
  ).generateInvoice;
  await run(
    'mutation{saveCollectionSettings(input:{upiId:"documents@upi",payeeName:"Domain Tests",confirmOwnership:true}){version}}',
  );
  async function prepare(kind: string, id: string, locale = 'en') {
    return (
      await run(
        'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id snapshot}}',
        { input: { requestId: randomUUID(), kind, sourceId: id, locale } },
      )
    ).prepareDocument;
  }
  const doc = await prepare('INVOICE', invoice.id, 'hi'),
    snapshot = JSON.parse(doc.snapshot);
  assert.equal(snapshot.totals[0].amount, '7.00');
  assert.equal(new URL(snapshot.upiUri).searchParams.get('am'), '7.00');
  const qr = PNG.sync.read(
      Buffer.from(snapshot.qrDataUrl.split(',')[1], 'base64'),
    ),
    decoded = jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height);
  assert.equal(decoded?.data, snapshot.upiUri);
  const generation = (
    await run(
      'mutation($input:GenerateDocumentInput!){generateDocument(input:$input){status}}',
      { input: { requestId: randomUUID(), documentId: doc.id } },
    )
  ).generateDocument;
  assert.equal(generation.status, 'READY');
  const link = (
    await run(
      'mutation($input:DocumentLinkInput!){createDocumentLink(input:$input){url}}',
      { input: { requestId: randomUUID(), documentId: doc.id } },
    )
  ).createDocumentLink;
  const png = await api.fetch(new Request(link.url + '/qr.png'));
  assert.equal(png.status, 200);
  assert.deepEqual(
    Buffer.from(await png.arrayBuffer()),
    Buffer.from(snapshot.qrDataUrl.split(',')[1], 'base64'),
  );
  const pdf = await api.fetch(
      new Request('http://localhost/documents/owner/' + doc.id, {
        headers: { cookie: f.cookie },
      }),
    ),
    bytes = Buffer.from(await pdf.arrayBuffer());
  assert.match(bytes.toString('latin1'), /NotoSansDevanagari/);
  await mkdir('.cache/pdf-proof', { recursive: true });
  await writeFile('.cache/pdf-proof/invoice-hi.pdf', bytes);
  await run('mutation($input:PaymentInput!){recordPayment(input:$input){id}}', {
    input: {
      requestId: randomUUID(),
      residentId: f.resident.id,
      purpose: 'ACCOUNT',
      method: 'CASH',
      amount: '7',
      date: f.today,
      confirmReceived: true,
      confirmationNote: 'Owner received invoice payment',
    },
  });
  const preserved = (
    await run('query($id:ID!){document(id:$id){snapshot}}', { id: doc.id })
  ).document;
  assert.equal(
    preserved.snapshot,
    doc.snapshot,
    'Prepared documents must not change when later funds arrive',
  );
  const fresh = JSON.parse((await prepare('INVOICE', invoice.id)).snapshot);
  assert.equal(fresh.qrDataUrl, null);
  assert.equal(fresh.totals[1].amount, '0.00');
  const cp = (
    await run(
      'query($input:ClearancePreviewInput!){previewClearance(input:$input){fingerprint}}',
      { input: { residentId: f.resident.id, terminationDate: f.today } },
    )
  ).previewClearance;
  const clearance = (
    await run(
      'mutation($input:ClearanceInput!){clearResident(input:$input){id refundDue}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: f.resident.id,
          terminationDate: f.today,
          previewFingerprint: cp.fingerprint,
          acknowledgeUnmarkedDays: true,
        },
      },
    )
  ).clearResident;
  assert.equal(clearance.refundDue, '10.00');
  const refund = (
    await run(
      'mutation($input:ClearanceRefundInput!){confirmClearanceRefund(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          clearanceId: clearance.id,
          amount: '10',
          method: 'CASH',
          confirmationNote: 'Owner actually returned the deposit',
        },
      },
    )
  ).confirmClearanceRefund;
  const refunded = JSON.parse(
    (await prepare('CLEARANCE_REFUND', refund.id)).snapshot,
  );
  assert.equal(refunded.totals[0].amount, '10.00');
  assert.equal(refunded.lines[0].description, 'Refunded deposit');
  const staff = (
    await run(
      'mutation{saveStaff(input:{name:"Pay Document Staff",staffCode:"DOC-PAY",phone:"9876543210",status:ACTIVE}){id}}',
    )
  ).saveStaff;
  await run('mutation($input:PayRuleInput!){savePayRule(input:$input){id}}', {
    input: {
      requestId: randomUUID(),
      staffId: staff.id,
      startDate: '2026-01-01',
      employmentStart: '2026-01-01',
      mode: 'SALARY',
      monthlySalary: '100',
      copyRate: '0',
      routeAllowance: '0',
      proration: 'CALENDAR_DAYS',
    },
  });
  const pp = (
    await run(
      'query($staff:ID!){payrollPreview(staffId:$staff,month:"2026-01"){fingerprint}}',
      { staff: staff.id },
    )
  ).payrollPreview;
  const payslip = (
    await run('mutation($input:PayslipInput!){postPayslip(input:$input){id}}', {
      input: {
        requestId: randomUUID(),
        staffId: staff.id,
        month: '2026-01',
        fingerprint: pp.fingerprint,
        acknowledgeMissing: true,
      },
    })
  ).postPayslip;
  const pay = JSON.parse((await prepare('PAYSLIP', payslip.id)).snapshot);
  assert.equal(pay.totals[0].amount, '100.00');
  assert.equal(pay.subject.name, 'Pay Document Staff');
  assert.equal(pay.note, 'Awaiting payout');
  const sourcesQuery =
    'query($input:DocumentSourcesInput!){documentSources(input:$input){items{id kind title date version}hasMore}}';
  for (const [kind, id] of [
    ['INVOICE', invoice.id],
    ['PAYMENT_RECEIPT', f.payment.id],
    ['CLEARANCE_REFUND', refund.id],
    ['PAYSLIP', payslip.id],
  ]) {
    const listed = await run(sourcesQuery, {
      input: {
        kind,
        ...(kind === 'PAYSLIP'
          ? { staffId: staff.id }
          : { residentId: f.resident.id }),
      },
    });
    assert.ok(
      listed.documentSources.items.some(
        (row: { id: string; title: string }) =>
          row.id === id && row.title.length > 0,
      ),
    );
    assert.equal(listed.documentSources.hasMore, false);
  }
  const empty = await run(sourcesQuery, {
    input: {
      kind: 'PAYSLIP',
      staffId: staff.id,
      from: '2025-01-01',
      to: '2025-12-31',
    },
  });
  assert.deepEqual(empty.documentSources.items, []);
  const forbidden = await api.query(await api.agency(), sourcesQuery, {
    input: { kind: 'PAYMENT_RECEIPT', residentId: f.resident.id },
  });
  assert.ok(forbidden.errors);
});
test('resident document links expire, revoke and retry safely without storing raw bearer tokens', async () => {
  process.env.DOCUMENT_LINK_SECRET =
    'synthetic-document-link-key-not-for-live-use-0123456789';
  process.env.PUBLIC_APP_ORIGIN = 'https://documents.example.test';
  const f = await source(),
    doc = (
      await api.query(
        f.cookie,
        'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id}}',
        {
          input: {
            requestId: randomUUID(),
            kind: 'PAYMENT_RECEIPT',
            sourceId: f.payment.id,
            locale: 'en',
          },
        },
      )
    ).data.prepareDocument;
  const generation = await api.query(
    f.cookie,
    'mutation($input:GenerateDocumentInput!){generateDocument(input:$input){status}}',
    { input: { requestId: randomUUID(), documentId: doc.id } },
  );
  assert.equal(generation.data.generateDocument.status, 'READY');
  const input = { requestId: randomUUID(), documentId: doc.id, expiryDays: 7 },
    q =
      'mutation($input:DocumentLinkInput!){createDocumentLink(input:$input){id status url expiresAt}}';
  const created = await api.query(f.cookie, q, { input });
  assert.ok(created.data?.createDocumentLink, JSON.stringify(created));
  const link = created.data.createDocumentLink;
  assert.equal(link.status, 'ACTIVE');
  const url = new URL(link.url),
    token = url.pathname.split('/').at(-1)!;
  assert.equal(url.origin, 'https://documents.example.test');
  assert.match(token, /^[a-f0-9]{64}$/);
  const repeat = await api.query(f.cookie, q, { input });
  assert.equal(repeat.data.createDocumentLink.url, link.url);
  const stored = await withTenant(api.pool, f.agencyId, async (c) => ({
    link: (
      await c.query(
        'SELECT token_hash FROM daybook.document_links WHERE id=$1',
        [link.id],
      )
    ).rows[0],
    request: (
      await c.query(
        'SELECT result::text FROM daybook.mutation_requests WHERE request_id=$1',
        [input.requestId],
      )
    ).rows[0],
  }));
  assert.equal(
    stored.link.token_hash,
    createHash('sha256').update(token).digest('hex'),
  );
  assert.ok(!stored.request.result.includes(token));
  const download = await api.fetch(new Request(link.url));
  assert.equal(download.status, 200);
  assert.equal(
    Buffer.from(await download.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    '%PDF-',
  );
  const wrong = new URL(link.url);
  wrong.pathname = wrong.pathname.replace(token, '0'.repeat(64));
  assert.equal((await api.fetch(new Request(wrong))).status, 404);
  const other = await api.agency();
  const forged = await api.query(other, q, {
    input: { ...input, requestId: randomUUID() },
  });
  assert.ok(forged.errors);
  const revoked = await api.query(
    f.cookie,
    'mutation($input:RevokeDocumentLinkInput!){revokeDocumentLink(input:$input){status}}',
    { input: { requestId: randomUUID(), linkId: link.id } },
  );
  assert.equal(revoked.data.revokeDocumentLink.status, 'REVOKED');
  assert.equal((await api.fetch(new Request(link.url))).status, 404);
  const old = await api.query(f.cookie, q, { input });
  assert.equal(old.data.createDocumentLink.status, 'REVOKED');
  assert.equal(old.data.createDocumentLink.url, null);
  const expiredToken = 'e'.repeat(64);
  await withTenant(api.pool, f.agencyId, (c) =>
    c.query(
      "INSERT INTO daybook.document_links(id,agency_id,document_id,request_id,token_hash,created_at,expires_at,created_by) SELECT $1,agency_id,id,$2,$3,now()-interval '2 days',now()-interval '1 day',created_by FROM daybook.documents WHERE id=$4",
      [
        randomUUID(),
        randomUUID(),
        createHash('sha256').update(expiredToken).digest('hex'),
        doc.id,
      ],
    ),
  );
  assert.equal(
    (
      await api.fetch(
        new Request(
          `https://documents.example.test/documents/public/${f.agencyId}/${expiredToken}`,
        ),
      )
    ).status,
    404,
  );
});
async function source(purpose = 'ACCOUNT') {
  const cookie = await api.agency(),
    route = await api.route(cookie),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const resident = (
    await api.query(
      cookie,
      'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          name: 'Document Resident',
          address: '1 Lotus Lane',
          phone: '9876543210',
          sector: 'Lotus Lane',
          routeId: route.id,
          dropOrder: 1,
        },
      },
    )
  ).data.saveResident;
  const payment = (
    await api.query(
      cookie,
      'mutation($input:PaymentInput!){recordPayment(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          residentId: resident.id,
          purpose,
          method: 'CASH',
          amount: '10',
          date: today,
          confirmReceived: true,
          confirmationNote: 'Owner confirmed received money',
        },
      },
    )
  ).data.recordPayment;
  return {
    cookie,
    payment,
    resident,
    today,
    route,
    agencyId: (await api.query(cookie, '{me{agencyId}}')).data.me.agencyId,
  };
}
test('incoming deposit receipt labels remain received money in every supported language', async () => {
  const f = await source('DEPOSIT');
  for (const [locale, description] of [
    ['en', 'Deposit received'],
    ['ml', 'ലഭിച്ച നിക്ഷേപം'],
    ['hi', 'प्राप्त जमा राशि'],
  ]) {
    const r = await api.query(
      f.cookie,
      'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){snapshot}}',
      {
        input: {
          requestId: randomUUID(),
          kind: 'PAYMENT_RECEIPT',
          sourceId: f.payment.id,
          locale,
        },
      },
    );
    assert.ok(r.data?.prepareDocument, JSON.stringify(r));
    const snapshot = JSON.parse(r.data.prepareDocument.snapshot);
    assert.equal(snapshot.lines[0].description, description);
    assert.equal(snapshot.lines[0].amount, '10.00');
  }
});
test('expired final generation leases become a visible terminal failure for direct and worker paths', async () => {
  const f = await source();
  const prepared = (
    await api.query(
      f.cookie,
      'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id}}',
      {
        input: {
          requestId: randomUUID(),
          kind: 'PAYMENT_RECEIPT',
          sourceId: f.payment.id,
          locale: 'en',
        },
      },
    )
  ).data.prepareDocument;
  async function expired() {
    const id = randomUUID();
    await withTenant(api.pool, f.agencyId, (c) =>
      c.query(
        "INSERT INTO daybook.documents(id,agency_id,kind,source_id,source_version,resident_id,staff_id,locale,snapshot,snapshot_hash,filename,status,attempts,lease_until,created_by) SELECT $1,agency_id,kind,source_id,source_version,resident_id,staff_id,locale,snapshot,snapshot_hash,filename,'GENERATING',3,now()-interval '1 minute',created_by FROM daybook.documents WHERE id=$2",
        [id, prepared.id],
      ),
    );
    return id;
  }
  const direct = await expired();
  await generateOneDocument(api.pool, f.agencyId, direct);
  const a = await api.query(
    f.cookie,
    'query($id:ID!){document(id:$id){status lastError}}',
    { id: direct },
  );
  assert.equal(a.data.document.status, 'FAILED');
  assert.ok(a.data.document.lastError);
  const worker = await expired();
  await runDocumentJobs(api.pool, f.agencyId);
  const b = await api.query(
    f.cookie,
    'query($id:ID!){document(id:$id){status}}',
    { id: worker },
  );
  assert.equal(b.data.document.status, 'FAILED');
});
test('a receipt document preserves confirmed money, generates a genuine PDF and isolates owner downloads by tenant', async () => {
  const encoding = (await api.pool.query('SHOW server_encoding')).rows[0]
    .server_encoding;
  assert.equal(
    encoding,
    'UTF8',
    'Trilingual documents require a Unicode database',
  );
  const cookie = await api.agency(),
    route = await api.route(cookie),
    today = (await api.query(cookie, '{deliveryMetrics{today}}')).data
      .deliveryMetrics.today;
  const residentResult = await api.query(
    cookie,
    'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        name: 'ഗോപാൽ <script>unsafe</script>',
        address: '1 Lotus Lane',
        phone: '9876543210',
        sector: 'Lotus Lane',
        routeId: route.id,
        dropOrder: 1,
      },
    },
  );
  assert.ok(residentResult.data?.saveResident, JSON.stringify(residentResult));
  const resident = residentResult.data.saveResident;
  const payment = await api.query(
    cookie,
    'mutation($input:PaymentInput!){recordPayment(input:$input){id}}',
    {
      input: {
        requestId: randomUUID(),
        residentId: resident.id,
        purpose: 'ACCOUNT',
        method: 'CASH',
        amount: '100.25',
        date: today,
        confirmReceived: true,
        confirmationNote: 'Counted owner receipt',
      },
    },
  );
  assert.ok(payment.data?.recordPayment, JSON.stringify(payment));
  const input = {
    requestId: randomUUID(),
    kind: 'PAYMENT_RECEIPT',
    sourceId: payment.data.recordPayment.id,
    locale: 'ml',
  };
  const q =
    'mutation($input:PrepareDocumentInput!){prepareDocument(input:$input){id kind status sourceId locale snapshot}}';
  const prepared = await api.query(cookie, q, { input });
  assert.ok(prepared.data?.prepareDocument, JSON.stringify(prepared));
  assert.equal(prepared.data.prepareDocument.status, 'PREPARED');
  const replay = await api.query(cookie, q, { input });
  assert.equal(
    replay.data.prepareDocument.id,
    prepared.data.prepareDocument.id,
  );
  const snapshot = JSON.parse(prepared.data.prepareDocument.snapshot);
  const html = renderFinancialDocument(snapshot);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.equal(snapshot.totals[0].amount, '100.25');
  assert.equal(snapshot.locale, 'ml');
  const generated = await api.query(
    cookie,
    'mutation($input:GenerateDocumentInput!){generateDocument(input:$input){id status byteLength sha256}}',
    {
      input: {
        requestId: randomUUID(),
        documentId: prepared.data.prepareDocument.id,
      },
    },
  );
  assert.ok(generated.data?.generateDocument, JSON.stringify(generated));
  assert.equal(generated.data.generateDocument.status, 'READY');
  assert.ok(generated.data.generateDocument.byteLength > 1000);
  assert.match(generated.data.generateDocument.sha256, /^[a-f0-9]{64}$/);
  const download = await api.fetch(
    new Request(
      'http://localhost/documents/owner/' + prepared.data.prepareDocument.id,
      { headers: { cookie } },
    ),
  );
  assert.equal(download.status, 200);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.match(bytes.toString('latin1'), /NotoSansMalayalam/);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    generated.data.generateDocument.sha256,
  );
  const other = await api.agency(),
    leak = await api.query(
      other,
      'query($id:ID!){document(id:$id){snapshot}}',
      { id: prepared.data.prepareDocument.id },
    );
  assert.ok(leak.errors);
  const forbidden = await api.fetch(
    new Request(
      'http://localhost/documents/owner/' + prepared.data.prepareDocument.id,
      { headers: { cookie: other } },
    ),
  );
  assert.equal(forbidden.status, 404);
  await mkdir('.cache/pdf-proof', { recursive: true });
  await writeFile('.cache/pdf-proof/receipt-ml.pdf', bytes);
});

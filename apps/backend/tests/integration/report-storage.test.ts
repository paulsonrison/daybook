import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { after, test } from 'node:test';
import { testApi } from './support.js';
import { withTenant } from '../../src/db/tenant.js';
import { writeReportWorkbook } from '../../src/modules/reports/workbook.js';
const api = testApi();
after(() => api.pool.end());
test('monthly report storage forces tenant isolation and preserves issued artifacts and source snapshots', async () => {
  const cookie = await api.agency(),
    foreign = await api.agency();
  const owner = (await api.query(cookie, '{me{id agencyId}}')).data.me;
  const other = (await api.query(foreign, '{me{agencyId}}')).data.me;
  const id = randomUUID(),
    snapshot = {
      version: 1 as const,
      kind: 'SALES' as const,
      locale: 'en' as const,
      reference: id,
      title: 'Recorded sales',
      agencyName: 'Original Agency',
      month: '2026-01',
      generatedAt: '2026-02-01T00:00:00Z',
      balanceAsOf: '2026-02-01',
      meta: [],
      notes: [],
      sections: [
        {
          title: 'Sales',
          columns: ['Amount'],
          rows: [['9007199254740993.93']],
        },
      ],
    };
  const hash = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
  await withTenant(api.pool, owner.agencyId, async (c) => {
    await c.query(
      "INSERT INTO daybook.agency_reports(id,agency_id,kind,month,locale,snapshot,snapshot_hash,created_by) VALUES($1,$2,'SALES','2026-01-01','en',$3,$4,$5)",
      [id, owner.agencyId, snapshot, hash, owner.id],
    );
    await c.query(
      "INSERT INTO daybook.report_artifacts(agency_id,report_id,format) VALUES($1,$2,'XLSX')",
      [owner.agencyId, id],
    );
  });
  assert.equal(
    await withTenant(
      api.pool,
      other.agencyId,
      async (c) =>
        (
          await c.query('SELECT id FROM daybook.agency_reports WHERE id=$1', [
            id,
          ])
        ).rowCount,
    ),
    0,
  );
  assert.equal(
    await withTenant(
      api.pool,
      other.agencyId,
      async (c) =>
        (
          await c.query(
            'SELECT report_id FROM daybook.report_artifacts WHERE report_id=$1',
            [id],
          )
        ).rowCount,
    ),
    0,
  );
  await assert.rejects(
    withTenant(api.pool, owner.agencyId, (c) =>
      c.query("UPDATE daybook.agency_reports SET snapshot='{}' WHERE id=$1", [
        id,
      ]),
    ),
    (e: unknown) => (e as { code: string }).code === '42501',
  );
  await assert.rejects(
    withTenant(api.pool, other.agencyId, (c) =>
      c.query(
        "INSERT INTO daybook.report_artifacts(agency_id,report_id,format) VALUES($1,$2,'PDF')",
        [owner.agencyId, id],
      ),
    ),
    (e: unknown) => (e as { code: string }).code === '42501',
  );
  const body = await writeReportWorkbook(snapshot),
    sha = createHash('sha256').update(body).digest('hex');
  await withTenant(api.pool, owner.agencyId, (c) =>
    c.query(
      "UPDATE daybook.report_artifacts SET status='READY',body=$2,sha256=$3 WHERE report_id=$1",
      [id, body, sha],
    ),
  );
  await assert.rejects(
    withTenant(api.pool, owner.agencyId, (c) =>
      c.query(
        "UPDATE daybook.report_artifacts SET status='FAILED',body=NULL,sha256=NULL WHERE report_id=$1",
        [id],
      ),
    ),
    (e: unknown) => (e as { code: string }).code === '23514',
  );
  const issued = await withTenant(
    api.pool,
    owner.agencyId,
    async (c) =>
      (
        await c.query(
          'SELECT body,byte_length,sha256 FROM daybook.report_artifacts WHERE report_id=$1',
          [id],
        )
      ).rows[0],
  );
  assert.deepEqual(issued.body, body);
  assert.equal(issued.byte_length, body.length);
  assert.equal(issued.sha256, sha);
});

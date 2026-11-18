import type { Pool } from 'pg';
import { currentAgent } from '../auth/repository.js';
import { withTenant } from '../../db/tenant.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'private, no-store' },
  });

export async function handleReportRequest(request: Request, pool: Pool) {
  if (!['GET', 'HEAD'].includes(request.method)) return missing();
  const match = /^\/reports\/owner\/([0-9a-f-]{36})\/(pdf|xlsx)$/i.exec(
    new URL(request.url).pathname,
  );
  if (!match || !uuid.test(match[1])) return missing();
  const agent = await currentAgent(pool, request);
  if (!agent)
    return new Response(
      request.method === 'HEAD' ? null : 'Sign in to download reports',
      {
        status: 401,
        headers: { 'cache-control': 'private, no-store' },
      },
    );
  const format = match[2].toUpperCase();
  const record = await withTenant(
    pool,
    agent.agencyId,
    async (c) =>
      (
        await c.query<{
          kind: string;
          month: string;
          body: Buffer;
          sha256: string;
        }>(
          `SELECT r.kind,to_char(r.month,'YYYY-MM') AS month,a.body,a.sha256 FROM daybook.agency_reports r JOIN daybook.report_artifacts a ON(a.agency_id,a.report_id)=(r.agency_id,r.id) WHERE r.id=$1 AND a.format=$2 AND a.status='READY'`,
          [match[1], format],
        )
      ).rows[0],
  );
  if (!record) return missing();
  const extension = format.toLowerCase();
  return new Response(
    request.method === 'HEAD' ? null : new Uint8Array(record.body),
    {
      headers: {
        'content-type':
          format === 'PDF'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="daybook-${record.kind.toLowerCase()}-${record.month}.${extension}"`,
        'content-length': String(record.body.length),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        etag: `"${record.sha256}"`,
      },
    },
  );
}

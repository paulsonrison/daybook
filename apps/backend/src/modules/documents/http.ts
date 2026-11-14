import type { Pool } from 'pg';
import { currentAgent } from '../auth/repository.js';
import { withTenant } from '../../db/tenant.js';
import { documentTokenHash } from './links.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'private, no-store' },
  });
function download(
  request: Request,
  bytes: Buffer,
  filename: string,
  qr = false,
) {
  return new Response(
    request.method === 'HEAD' ? null : new Uint8Array(bytes),
    {
      headers: {
        'content-type': qr ? 'image/png' : 'application/pdf',
        'content-disposition': `${qr ? 'inline' : 'attachment'}; filename="${filename}"`,
        'content-length': String(bytes.length),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    },
  );
}
export async function handleDocumentRequest(request: Request, pool: Pool) {
  if (!['GET', 'HEAD'].includes(request.method)) return notFound();
  const path = new URL(request.url).pathname,
    match = /^\/documents\/owner\/([0-9a-f-]{36})$/.exec(path);
  const publicMatch =
    /^\/documents\/public\/([0-9a-f-]{36})\/([a-f0-9]{64})(\/qr\.png)?$/.exec(
      path,
    );
  if (publicMatch) {
    const [, agencyId, token, asset] = publicMatch;
    if (!uuid.test(agencyId)) return notFound();
    const qr = Boolean(asset),
      row = await withTenant(
        pool,
        agencyId,
        async (c) =>
          (
            await c.query<{ pdf: Buffer; filename: string; qr: string | null }>(
              `SELECT ${qr ? "d.snapshot->>'qrDataUrl' AS qr" : 'd.pdf,d.filename'} FROM daybook.document_links l JOIN daybook.documents d ON(d.agency_id,d.id)=(l.agency_id,l.document_id) WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>now() AND d.status='READY'`,
              [documentTokenHash(token)],
            )
          ).rows[0],
      );
    if (!row) return notFound();
    if (qr) {
      if (
        !row.qr ||
        row.qr.length > 200000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(row.qr)
      )
        return notFound();
      const png = Buffer.from(
        row.qr.slice('data:image/png;base64,'.length),
        'base64',
      );
      if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
        return notFound();
      return download(request, png, 'upi-qr.png', true);
    }
    return download(request, row.pdf, row.filename);
  }
  if (!match || !uuid.test(match[1])) return notFound();
  const agent = await currentAgent(pool, request);
  if (!agent)
    return new Response('Sign in to download documents', {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    });
  const row = await withTenant(
    pool,
    agent.agencyId,
    async (c) =>
      (
        await c.query<{ pdf: Buffer; filename: string; sha256: string }>(
          "SELECT pdf,filename,sha256 FROM daybook.documents WHERE id=$1 AND status='READY'",
          [match[1]],
        )
      ).rows[0],
  );
  if (!row) return notFound();
  return download(request, row.pdf, row.filename);
}

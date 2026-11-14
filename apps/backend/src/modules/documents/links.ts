import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  audit,
  configMutation,
  fail,
  idValue,
  type RequestContext,
} from '../context.js';
import { financialRead } from '../billing/transactions.js';
import { onceRequest } from '../requests.js';
export interface DocumentLinkInput {
  requestId: string;
  documentId: string;
  expiryDays?: number;
}
export interface RevokeDocumentLinkInput {
  requestId: string;
  linkId: string;
}
function configuration() {
  const secret = process.env.DOCUMENT_LINK_SECRET,
    origin = process.env.PUBLIC_APP_ORIGIN;
  if (!secret || Buffer.byteLength(secret) < 32 || !origin) return null;
  try {
    const url = new URL(origin),
      local =
        process.env.NODE_ENV !== 'production' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return { secret, origin: url.origin };
  } catch {
    return null;
  }
}
export const publicDocumentStatus = () =>
  configuration() ? 'CONFIGURED' : 'NOT_CONFIGURED';
/** Internal worker capability, prepared before rendering; public reads still require READY. */
export async function createSystemDocumentLink(
  c: PoolClient,
  agencyId: string,
  documentId: string,
) {
  const cfg = configuration();
  if (!cfg) return null;
  const id = randomUUID(),
    requestId = randomUUID();
  const token = tokenFor(cfg.secret, agencyId, documentId, requestId);
  await c.query(
    "INSERT INTO daybook.document_links(id,agency_id,document_id,request_id,token_hash,expires_at,created_by,actor_kind) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',NULL,'SYSTEM')",
    [id, agencyId, documentId, requestId, documentTokenHash(token)],
  );
  return id;
}
export const documentTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
function tokenFor(
  secret: string,
  agencyId: string,
  documentId: string,
  requestId: string,
) {
  return createHmac('sha256', secret)
    .update(`document-link:v1:${agencyId}:${documentId}:${requestId}`)
    .digest('hex');
}
type LinkRow = {
  id: string;
  documentId: string;
  requestId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  status: string;
};
const columns = `id,document_id AS "documentId",request_id AS "requestId",token_hash AS "tokenHash",expires_at AS "expiresAt",created_at AS "createdAt",CASE WHEN revoked_at IS NOT NULL THEN 'REVOKED' WHEN expires_at<=now() THEN 'EXPIRED' ELSE 'ACTIVE' END AS status`;
function view(agencyId: string, row: LinkRow) {
  const cfg = configuration();
  let url: string | null = null,
    urlStatus = row.status;
  if (row.status === 'ACTIVE') {
    urlStatus = cfg ? 'KEY_CHANGED' : 'NOT_CONFIGURED';
    if (cfg) {
      const token = tokenFor(
        cfg.secret,
        agencyId,
        row.documentId,
        row.requestId,
      );
      if (documentTokenHash(token) === row.tokenHash) {
        url = `${cfg.origin}/documents/public/${agencyId}/${token}`;
        urlStatus = 'READY';
      }
    }
  }
  return {
    id: row.id,
    documentId: row.documentId,
    status: row.status,
    urlStatus,
    url,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
export async function readDocumentLink(
  c: PoolClient,
  agencyId: string,
  id: string,
) {
  idValue(id);
  const row = (
    await c.query<LinkRow>(
      `SELECT ${columns} FROM daybook.document_links WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) return fail('Document link not found.', 'NOT_FOUND');
  return view(agencyId, row);
}
export const documentLinks = (ctx: RequestContext, documentId: string) =>
  financialRead(ctx, async (c) => {
    idValue(documentId);
    if (
      !(
        await c.query('SELECT 1 FROM daybook.documents WHERE id=$1', [
          documentId,
        ])
      ).rowCount
    )
      fail('Document not found.', 'NOT_FOUND');
    return (
      await c.query<LinkRow>(
        `SELECT ${columns} FROM daybook.document_links WHERE document_id=$1 ORDER BY created_at DESC,id LIMIT 200`,
        [documentId],
      )
    ).rows.map((r) => view(ctx.agent!.agencyId, r));
  });
export function createDocumentLink(ctx: RequestContext, i: DocumentLinkInput) {
  return configMutation(ctx, async (c) => {
    const saved = await onceRequest(
      c,
      ctx.agent!.agencyId,
      i.requestId,
      'document.link',
      i,
      async () => {
        idValue(i.documentId);
        const doc = (
          await c.query<{ status: string }>(
            'SELECT status FROM daybook.documents WHERE id=$1',
            [i.documentId],
          )
        ).rows[0];
        if (!doc) fail('Document not found.', 'NOT_FOUND');
        if (doc.status !== 'READY')
          fail('Generate the document before creating a resident link.');
        const cfg = configuration();
        if (!cfg)
          return fail(
            'Public document links are not configured. Owner downloads remain available.',
            'NOT_CONFIGURED',
          );
        const days = i.expiryDays ?? 7;
        if (!Number.isInteger(days) || days < 1 || days > 30)
          fail('Choose a document-link lifetime of one to thirty days.');
        const id = randomUUID(),
          token = tokenFor(
            cfg.secret,
            ctx.agent!.agencyId,
            i.documentId,
            i.requestId,
          );
        await c.query(
          "INSERT INTO daybook.document_links(id,agency_id,document_id,request_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5,now()+($6::integer*interval '24 hours'),$7)",
          [
            id,
            ctx.agent!.agencyId,
            i.documentId,
            i.requestId,
            documentTokenHash(token),
            days,
            ctx.agent!.id,
          ],
        );
        await audit(c, ctx, 'document_link', id, 'CREATED', {
          documentId: i.documentId,
          expiryDays: days,
        });
        return { id };
      },
    );
    return readDocumentLink(c, ctx.agent!.agencyId, saved.id);
  });
}
export function revokeDocumentLink(
  ctx: RequestContext,
  i: RevokeDocumentLinkInput,
) {
  return configMutation(ctx, async (c) => {
    const saved = await onceRequest(
      c,
      ctx.agent!.agencyId,
      i.requestId,
      'document.revoke-link',
      i,
      async () => {
        const old = await readDocumentLink(c, ctx.agent!.agencyId, i.linkId);
        if (old.status !== 'REVOKED') {
          await c.query(
            'UPDATE daybook.document_links SET revoked_at=now(),revoked_by=$2 WHERE id=$1',
            [i.linkId, ctx.agent!.id],
          );
          await audit(c, ctx, 'document_link', i.linkId, 'REVOKED', {
            documentId: old.documentId,
          });
        }
        return { id: i.linkId };
      },
    );
    return readDocumentLink(c, ctx.agent!.agencyId, saved.id);
  });
}

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import type { ProviderRegistry } from './config.js';
import { verifySms, verifyWhatsApp } from './signatures.js';
import {
  recordProviderEvent,
  associateSmsCallback,
  type ProviderEvent,
} from './outbox.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const response = (status: number, body = '') =>
  new Response(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain',
      'x-content-type-options': 'nosniff',
    },
  });
async function rawBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('BODY_TIMEOUT')), 5000);
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 65536) throw new Error('BODY_TOO_LARGE');
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
function providerStatus(status: unknown): ProviderEvent['status'] | null {
  if (['accepted', 'queued', 'sending', 'sent'].includes(String(status)))
    return 'ACCEPTED';
  if (status === 'delivered') return 'DELIVERED';
  if (status === 'read') return 'READ';
  if (status === 'failed' || status === 'undelivered') return 'FAILED';
  return null;
}
const eventKey = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function handleProviderRequest(
  request: Request,
  pool: Pool,
  providers: ProviderRegistry,
  publicOrigin?: string,
) {
  const url = new URL(request.url);
  const match = /^\/webhooks\/(whatsapp|sms)\/([0-9a-f-]{36})$/.exec(
    url.pathname,
  );
  if (!match || !uuid.test(match[2])) return response(404);
  const [, kind, agencyId] = match;
  const configured = providers.get(
    agencyId,
    kind === 'sms' ? 'SMS' : 'WHATSAPP',
  );
  if (configured.status !== 'CONFIGURED') return response(404);
  const config = configured.transport;
  if (request.method === 'GET' && kind === 'whatsapp') {
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const expected = configured.verifyToken ?? '';
    const tokenBytes = Buffer.from(token),
      expectedBytes = Buffer.from(expected);
    if (
      !expected ||
      tokenBytes.length !== expectedBytes.length ||
      !timingSafeEqual(tokenBytes, expectedBytes) ||
      url.searchParams.get('hub.mode') !== 'subscribe'
    )
      return response(403);
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    return /^\d{1,100}$/.test(challenge)
      ? response(200, challenge)
      : response(400);
  }
  if (request.method !== 'POST') return response(405);
  try {
    const body = await rawBody(request);
    const type = request.headers.get('content-type')?.split(';')[0].trim();
    const events: ProviderEvent[] = [];
    if (config.channel === 'WHATSAPP') {
      if (type !== 'application/json') return response(415);
      if (
        !verifyWhatsApp(
          configured.appSecret ?? '',
          config.phoneNumberId,
          body,
          request.headers.get('x-hub-signature-256') ?? '',
        )
      )
        return response(403);
      const parsed = JSON.parse(body);
      for (const entry of parsed.entry)
        for (const change of entry.changes) {
          const statuses = change.value.statuses;
          if (statuses === undefined) continue;
          if (!Array.isArray(statuses)) return response(400);
          for (const value of statuses) {
            const status = providerStatus(value?.status);
            if (!status) continue;
            if (
              typeof value.id !== 'string' ||
              !value.id ||
              value.id.length > 255
            )
              return response(400);
            events.push({
              channel: 'WHATSAPP',
              messageId: value.id,
              status,
              eventKey: eventKey([value.id, status, value.timestamp ?? null]),
            });
          }
        }
    } else {
      if (type !== 'application/x-www-form-urlencoded') return response(415);
      const intent = url.searchParams.get('intent');
      if (!intent || !uuid.test(intent) || [...url.searchParams].length !== 1)
        return response(400);
      let canonical: URL;
      try {
        canonical = new URL(publicOrigin ?? '');
        if (
          canonical.protocol !== 'https:' ||
          canonical.href !== `${canonical.origin}/`
        )
          return response(503);
      } catch {
        return response(503);
      }
      const form = new URLSearchParams(body);
      const params: Record<string, string | string[]> = Object.create(null);
      for (const key of new Set(form.keys())) {
        const values = form.getAll(key);
        params[key] = values.length === 1 ? values[0] : values;
      }
      if (
        !verifySms(
          { ...config, sharedKeys: configured.sharedKeys },
          canonical.origin + url.pathname + url.search,
          params,
          request.headers.get('x-twilio-signature') ?? '',
          request.headers.get('x-twilio-webhooks-signature-settings') ??
            undefined,
        )
      )
        return response(403);
      const status = providerStatus(params.MessageStatus);
      if (status) {
        if (
          typeof params.MessageSid !== 'string' ||
          !params.MessageSid ||
          params.MessageSid.length > 255
        )
          return response(400);
        if (
          typeof params.To !== 'string' ||
          !(await associateSmsCallback(
            pool,
            agencyId,
            intent,
            params.MessageSid,
            params.To,
          ))
        )
          return response(403);
        events.push({
          channel: 'SMS',
          messageId: params.MessageSid,
          status,
          eventKey: eventKey([
            params.MessageSid,
            status,
            params.ErrorCode ?? null,
          ]),
        });
      }
    }
    if (events.length > 100) return response(413);
    for (const event of events)
      await recordProviderEvent(pool, agencyId, event);
    return response(200);
  } catch (error) {
    return response(
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? 413
        : error instanceof Error && error.message === 'BODY_TIMEOUT'
          ? 408
          : 503,
    );
  }
}

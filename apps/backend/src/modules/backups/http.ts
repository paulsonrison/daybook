import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { currentAgent } from '../auth/repository.js';
import type { BackupRequest } from './ipc.js';
const headers = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
async function emptyBody(request: Request) {
  const length = request.headers.get('content-length');
  if (length && length !== '0') return false;
  const reader = request.body?.getReader();
  if (!reader) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), 2000);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        for (let i = 0; i < 8; i++) {
          const { done, value } = await reader.read();
          if (done) return true;
          if (value?.byteLength) return false;
        }
        return false;
      })(),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function handleBackupRequest(
  request: Request,
  options: { pool?: Pool; request?: BackupRequest; secret?: string },
) {
  const path = new URL(request.url).pathname;
  const respond = (
    state: string,
    status: number,
    body: Record<string, unknown> = { state },
  ) => Response.json(body, { status, headers });
  if (path === '/internal/jobs/tick') {
    if (request.method !== 'POST') return respond('METHOD_NOT_ALLOWED', 405);
    if (
      !options.request ||
      !options.secret ||
      !/^[a-f0-9]{64}$/i.test(options.secret)
    )
      return respond('NOT_CONFIGURED', 503);
    const stamp = request.headers.get('x-daybook-timestamp') ?? '',
      signature = request.headers.get('x-daybook-signature') ?? '';
    if (
      !/^\d{13}$/.test(stamp) ||
      Math.abs(Date.now() - Number(stamp)) > 300000 ||
      !/^[a-f0-9]{64}$/i.test(signature)
    )
      return respond('UNAUTHORIZED', 401);
    const expected = createHmac('sha256', options.secret)
      .update(stamp + '\nPOST\n/internal/jobs/tick')
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      return respond('UNAUTHORIZED', 401);
    if (!(await emptyBody(request))) return respond('INVALID_REQUEST', 400);
    try {
      const result = await options.request('tick');
      const rawScheduled = result.scheduled;
      const scheduled =
        rawScheduled && typeof rawScheduled === 'object'
          ? (rawScheduled as Record<string, unknown>)
          : undefined;
      const scheduleState =
        typeof scheduled?.state === 'string' ? scheduled.state : undefined;
      const counts = Object.fromEntries(
        ['tenantsVisited', 'jobsCompleted', 'jobsFailed']
          .map((key) => [key, scheduled?.[key]])
          .filter(
            ([, value]) =>
              Number.isInteger(value) &&
              Number(value) >= 0 &&
              Number(value) <= 1000,
          ),
      );
      const hasDeferredWork = scheduled?.hasDeferredWork;
      const response = {
        state: result.state,
        ...(scheduleState
          ? {
              scheduled: {
                state: scheduleState,
                ...counts,
                ...(typeof hasDeferredWork === 'boolean'
                  ? { hasDeferredWork }
                  : {}),
              },
            }
          : {}),
      };
      return respond(
        response.state,
        ['VERIFIED', 'SKIPPED'].includes(result.state) &&
          scheduleState === 'COMPLETED'
          ? 200
          : result.state === 'THROTTLED'
            ? 429
            : 503,
        response,
      );
    } catch {
      return respond('UNAVAILABLE', 503);
    }
  }
  if (path !== '/operations/backups') return respond('NOT_FOUND', 404);
  if (request.method !== 'GET') return respond('METHOD_NOT_ALLOWED', 405);
  if (!options.pool) return respond('UNAVAILABLE', 503);
  if (!(await currentAgent(options.pool, request)))
    return respond('UNAUTHORIZED', 401);
  if (!options.request) return respond('NOT_CONFIGURED', 503);
  try {
    const result = await options.request('status');
    return Response.json(result, {
      status: ['READY', 'NOT_CONFIGURED'].includes(result.state) ? 200 : 503,
      headers,
    });
  } catch {
    return respond('UNAVAILABLE', 503);
  }
}

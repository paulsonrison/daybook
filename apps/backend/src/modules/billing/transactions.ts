import type { PoolClient } from 'pg';
import { agencyRead, type RequestContext } from '../context.js';
export function financialRead<T>(
  ctx: RequestContext,
  work: (c: PoolClient) => Promise<T>,
) {
  return agencyRead(ctx, async (c) => {
    await c.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended('config:'||$1,0))",
      [ctx.agent!.agencyId],
    );
    return work(c);
  });
}

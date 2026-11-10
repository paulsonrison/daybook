import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { fail, idValue } from './context.js';
export async function onceRequest<T>(
  client: PoolClient,
  agencyId: string,
  requestId: string,
  operation: string,
  input: unknown,
  work: () => Promise<T>,
): Promise<T> {
  idValue(requestId);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const old = (
    await client.query<{ operation: string; fingerprint: string; result: T }>(
      'SELECT operation,fingerprint,result FROM daybook.mutation_requests WHERE request_id=$1',
      [requestId],
    )
  ).rows[0];
  if (old) {
    if (old.operation !== operation || old.fingerprint !== hash)
      return fail(
        'This request identifier was already used for another operation.',
        'CONFLICT',
      );
    return old.result;
  }
  const result = await work();
  await client.query(
    'INSERT INTO daybook.mutation_requests(agency_id,request_id,operation,fingerprint,result) VALUES($1,$2,$3,$4,$5)',
    [agencyId, requestId, operation, hash, JSON.stringify(result)],
  );
  return result;
}

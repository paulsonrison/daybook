import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant.js';
import type { AgentIdentity } from './auth/repository.js';
import type { ProviderRegistry } from './communications/config.js';

export interface RequestContext {
  agent: AgentIdentity | null;
  pool: Pool | undefined;
  request: Request;
  frontendOrigin: string;
  providers?: ProviderRegistry;
}
export const fail = (message: string, code = 'BAD_USER_INPUT'): never => {
  throw new GraphQLError(message, { extensions: { code } });
};
export function requireAgent(context: RequestContext) {
  if (!context.agent || !context.pool)
    fail('Sign in to continue.', 'UNAUTHENTICATED');
  return { agent: context.agent!, pool: context.pool! };
}
export async function agencyRead<T>(
  context: RequestContext,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const { agent, pool } = requireAgent(context);
  return withTenant(pool, agent.agencyId, work);
}
export async function configMutation<T>(
  context: RequestContext,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  requireAgent(context);
  if (
    context.request.method !== 'POST' ||
    context.request.headers.get('origin') !== context.frontendOrigin
  )
    fail('Request origin is not allowed.', 'FORBIDDEN');
  try {
    return await agencyRead(context, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('config:' || $1,0))",
        [context.agent!.agencyId],
      );
      return work(client);
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505')
      fail(
        'This identifier or delivery position is already in use.',
        'CONFLICT',
      );
    if (code === '23503')
      fail('A linked record is unavailable or still in use.');
    if (code === '23514')
      fail(
        'This change conflicts with a locked or invalid record. Review the data or record a correction in an open period.',
        'CONFLICT',
      );
    throw error;
  }
}
export function cleanText(value: unknown, label: string, max = 120): string {
  if (typeof value !== 'string') return fail(`Enter ${label}.`);
  const text = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!text || text.length > max || /[\x00-\x1f\x7f]/.test(text))
    return fail(`Enter a valid ${label} (up to ${max} characters).`);
  return text;
}
export function idValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return fail('Invalid record identifier.');
  return value;
}
export function versionMatches(actual: number, expected: unknown) {
  if (!Number.isInteger(expected) || actual !== expected)
    fail('This record changed. Reload it before saving.', 'CONFLICT');
}
export async function audit(
  client: PoolClient,
  context: RequestContext,
  entityType: string,
  entityId: string,
  action: string,
  details: unknown = {},
) {
  await client.query(
    'INSERT INTO daybook.audit_events(id,agency_id,actor_id,entity_type,entity_id,action,details) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      randomUUID(),
      context.agent!.agencyId,
      context.agent!.id,
      entityType,
      entityId,
      action,
      JSON.stringify(details),
    ],
  );
}

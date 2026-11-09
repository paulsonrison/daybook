import type { Pool, PoolClient } from 'pg';
import { tokenHash } from './credentials.js';

export interface AgentIdentity {
  id: string;
  agencyId: string;
  name: string;
  email: string;
  agency: { id: string; name: string };
}
type IdentityRow = {
  id: string;
  agency_id: string;
  name: string;
  email: string;
  agency_name: string;
  password_hash?: string;
};
export function identity(row: IdentityRow): AgentIdentity {
  return {
    id: row.id,
    agencyId: row.agency_id,
    name: row.name,
    email: row.email,
    agency: { id: row.agency_id, name: row.agency_name },
  };
}
export async function loginIdentity(pool: Pool, email: string) {
  const { rows } = await pool.query<IdentityRow>(
    'SELECT * FROM daybook.login_identity($1)',
    [email],
  );
  return rows[0];
}
export function sessionToken(request: Request): string | undefined {
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('daybook_session='))
    ?.slice('daybook_session='.length);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}
export async function currentAgent(
  pool: Pool,
  request: Request,
): Promise<AgentIdentity | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const { rows } = await pool.query<IdentityRow>(
    'SELECT * FROM daybook.session_identity($1)',
    [tokenHash(token)],
  );
  return rows[0] ? identity(rows[0]) : null;
}
export async function insertSession(
  client: PoolClient,
  agent: AgentIdentity,
  token: string,
) {
  await client.query(
    "INSERT INTO daybook.sessions(token_hash,agency_id,agent_id,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
    [tokenHash(token), agent.agencyId, agent.id],
  );
}

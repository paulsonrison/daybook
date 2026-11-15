import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { translate, translateRendered } from '@daybook/ui/messages';
import { requestLocale } from '../localization/service.js';
import { withTenant } from '../../db/tenant.js';
import { hashPassword, verifyPassword, tokenHash } from './credentials.js';
import {
  currentAgent,
  loginIdentity,
  identity,
  insertSession,
  sessionToken,
  type AgentIdentity,
} from './repository.js';

class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldLabel?: string,
  ) {
    super(message);
  }
}
const jsonResponse = (body: unknown, status = 200, cookie?: string) =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...(cookie ? { 'set-cookie': cookie } : {}),
    },
  });
const cookie = (token: string, maxAge: number) =>
  `daybook_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AuthError(`Enter a valid ${label}.`, 400, label);
  return value.trim();
}
async function boundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new AuthError('Request is too large.', 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}
export async function handleAuth(
  request: Request,
  pool: Pool,
  origin: string,
): Promise<Response> {
  const locale = requestLocale(request);
  const json = (body: unknown, status = 200, cookie?: string) => {
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
    )
      body = { ...body, error: translateRendered(locale, body.error) };
    return jsonResponse(body, status, cookie);
  };
  const action = new URL(request.url).pathname;
  try {
    if (action === '/auth/me' && request.method === 'GET') {
      const agent = await currentAgent(pool, request);
      return agent
        ? json({ agent })
        : json({ error: 'Sign in to continue.' }, 401);
    }
    if (!['/auth/register', '/auth/login', '/auth/logout'].includes(action))
      return json({ error: 'Not found.' }, 404);
    if (request.method !== 'POST')
      return json({ error: 'Method not allowed.' }, 405);
    if (request.headers.get('origin') !== origin)
      return json({ error: 'Request origin is not allowed.' }, 403);
    if (action === '/auth/logout') {
      const agent = await currentAgent(pool, request);
      if (agent)
        await withTenant(pool, agent.agencyId, (client) =>
          client.query('DELETE FROM daybook.sessions WHERE token_hash=$1', [
            tokenHash(sessionToken(request)!),
          ]),
        );
      return json({ ok: true }, 200, cookie('', 0));
    }
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new AuthError('Send JSON data.', 415);
    const raw = await boundedBody(request);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(raw);
      if (!input || Array.isArray(input) || typeof input !== 'object')
        throw new Error();
    } catch {
      throw new AuthError('Enter valid form data.', 400);
    }
    const email = text(input.email, 'email address', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AuthError('Enter a valid email address.', 400);
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.length < 12 || password.length > 128)
      throw new AuthError('Use a password between 12 and 128 characters.', 400);
    const attempt = await pool.query<{ allowed: boolean }>(
      'SELECT daybook.allow_auth_attempt($1,10) AS allowed',
      [tokenHash(email)],
    );
    if (!attempt.rows[0].allowed)
      throw new AuthError('Too many attempts. Try again in 15 minutes.', 429);
    const token = randomBytes(32).toString('hex');
    let agent: AgentIdentity;
    if (action === '/auth/register') {
      const name = text(input.name, 'name', 100),
        agencyName = text(input.agencyName, 'agency name', 120);
      agent = {
        id: randomUUID(),
        agencyId: randomUUID(),
        name,
        email,
        agency: { id: '', name: agencyName },
      };
      agent.agency.id = agent.agencyId;
      const passwordHash = await hashPassword(password);
      try {
        await withTenant(pool, agent.agencyId, async (client) => {
          await client.query(
            'INSERT INTO daybook.agencies(id,name) VALUES($1,$2)',
            [agent.agencyId, agencyName],
          );
          await client.query(
            'INSERT INTO daybook.agents(id,agency_id,name,email,password_hash) VALUES($1,$2,$3,$4,$5)',
            [agent.id, agent.agencyId, name, email, passwordHash],
          );
          await insertSession(client, agent, token);
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new AuthError(
            'Unable to create this account. Try signing in.',
            409,
          );
        throw error;
      }
    } else {
      const row = await loginIdentity(pool, email);
      if (!(await verifyPassword(password, row?.password_hash)) || !row)
        throw new AuthError('Email or password is incorrect.', 401);
      agent = identity(row);
      await withTenant(pool, agent.agencyId, (client) =>
        insertSession(client, agent, token),
      );
    }
    return json(
      { agent },
      action === '/auth/register' ? 201 : 200,
      cookie(token, 8 * 60 * 60),
    );
  } catch (error) {
    return error instanceof AuthError
      ? json(
          {
            error: error.fieldLabel
              ? translate(locale, 'Enter a valid {p0}.', {
                  p0: translate(locale, error.fieldLabel),
                })
              : error.message,
          },
          error.status,
        )
      : json({ error: 'Unable to complete this request. Try again.' }, 503);
  }
}

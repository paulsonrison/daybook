import type { AiProvider } from '../../src/modules/ai/provider.js';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../../src/app.js';
import type { ProviderRegistry } from '../../src/modules/communications/config.js';
export function testApi(
  providers?: ProviderRegistry,
  providerCallbackOrigin?: string,
  aiProvider?: AiProvider,
) {
  const pool = new pg.Pool({
    connectionString: process.env.TEST_RUNTIME_DATABASE_URL,
    max: 4,
  });
  const app = createApp({
    pool,
    databaseReady: async () => true,
    providers,
    providerCallbackOrigin,
    aiProvider,
  });
  async function agency() {
    const response = await app.fetch(
      new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agencyName: 'Domain Tests',
          name: 'Owner',
          email: `${randomUUID()}@example.test`,
          password: 'Domain test password 123',
        }),
      }),
    );
    if (response.status !== 201)
      throw new Error('Test agency creation failed.');
    return response.headers.get('set-cookie')!;
  }
  async function query(
    cookie: string,
    query: string,
    variables: Record<string, unknown> = {},
  ) {
    const response = await app.fetch(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      }),
    );
    return response.json();
  }
  async function route(cookie: string) {
    const t = await query(
      cookie,
      'mutation{saveTerritory(input:{name:"Central",locality:"Kochi",pinCodes:["682020"],sectors:["Lotus Lane"]}){id}}',
    );
    const r = await query(
      cookie,
      'mutation($territory:ID!){saveRoute(input:{code:"R01",name:"Lotus",territoryId:$territory,stops:[]}){id version}}',
      { territory: t.data.saveTerritory.id },
    );
    return r.data.saveRoute;
  }
  return { pool, agency, query, route, fetch: app.fetch.bind(app) };
}

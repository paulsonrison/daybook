import { createSchema, createYoga } from 'graphql-yoga';
import { GraphQLError } from 'graphql';
import type { Pool } from 'pg';
import { currentAgent } from './modules/auth/repository.js';
import { handleAuth } from './modules/auth/http.js';
import type { RequestContext } from './modules/context.js';
import {
  operationsTypeDefs,
  operationsResolvers,
} from './modules/operations/schema.js';
import { catalogTypeDefs, catalogResolvers } from './modules/catalog/schema.js';
import {
  subscriptionTypeDefs,
  subscriptionResolvers,
} from './modules/subscriptions/schema.js';
import {
  deliveryTypeDefs,
  deliveryResolvers,
} from './modules/delivery/schema.js';
import {
  publisherTypeDefs,
  publisherResolvers,
} from './modules/publishers/schema.js';
import {
  merchandiseTypeDefs,
  merchandiseResolvers,
} from './modules/merchandise/schema.js';
import { insertTypeDefs, insertResolvers } from './modules/inserts/schema.js';
export function createApp({
  databaseReady,
  frontendOrigin = 'http://localhost:3000',
  pool,
}: {
  databaseReady: () => Promise<boolean>;
  frontendOrigin?: string;
  pool?: Pool;
}) {
  return createYoga({
    graphqlEndpoint: '/graphql',
    graphiql: process.env.NODE_ENV !== 'production',
    cors: { origin: frontendOrigin, methods: ['GET', 'POST', 'OPTIONS'] },
    context: async ({ request }) => ({
      agent: pool ? await currentAgent(pool, request) : null,
      pool,
      request,
      frontendOrigin,
    }),
    schema: createSchema<RequestContext>({
      typeDefs: `type Health { status: String!, service: String! }
      type Agency { id: ID!, name: String! }
      type Agent { id: ID!, agencyId: ID!, name: String!, email: String!, agency: Agency! }
      type Query { health: Health!, me: Agent! }
      ${operationsTypeDefs}
      ${catalogTypeDefs}
      ${subscriptionTypeDefs}
      ${deliveryTypeDefs}
      ${publisherTypeDefs}
      ${merchandiseTypeDefs}
      ${insertTypeDefs}`,
      resolvers: {
        Query: {
          ...operationsResolvers.Query,
          ...catalogResolvers.Query,
          ...subscriptionResolvers.Query,
          ...deliveryResolvers.Query,
          ...publisherResolvers.Query,
          ...merchandiseResolvers.Query,
          ...insertResolvers.Query,
          health: () => ({ status: 'ok', service: 'daybook-api' }),
          me: (_root, _args, context) => {
            if (!context.agent)
              throw new GraphQLError('Sign in to continue.', {
                extensions: { code: 'UNAUTHENTICATED' },
              });
            return context.agent;
          },
        },
        Mutation: {
          ...operationsResolvers.Mutation,
          ...catalogResolvers.Mutation,
          ...subscriptionResolvers.Mutation,
          ...deliveryResolvers.Mutation,
          ...publisherResolvers.Mutation,
          ...merchandiseResolvers.Mutation,
          ...insertResolvers.Mutation,
        },
      },
    }),
    plugins: [
      {
        onRequest({ request, endResponse }) {
          const path = new URL(request.url).pathname;
          if (path.startsWith('/auth/')) {
            if (!pool)
              return endResponse(
                Response.json(
                  { error: 'Database unavailable.' },
                  { status: 503 },
                ),
              );
            return handleAuth(request, pool, frontendOrigin).then(endResponse);
          }
          if (path === '/health') endResponse(Response.json({ status: 'ok' }));
          if (path === '/ready') {
            return databaseReady().then((ready) => {
              endResponse(
                Response.json(
                  { status: ready ? 'ready' : 'unavailable' },
                  { status: ready ? 200 : 503 },
                ),
              );
            });
          }
        },
      },
    ],
  });
}

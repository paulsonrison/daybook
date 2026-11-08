import { createSchema, createYoga } from 'graphql-yoga';
export function createApp({
  databaseReady,
  frontendOrigin = 'http://localhost:3000',
}: {
  databaseReady: () => Promise<boolean>;
  frontendOrigin?: string;
}) {
  return createYoga({
    graphqlEndpoint: '/graphql',
    graphiql: process.env.NODE_ENV !== 'production',
    cors: { origin: frontendOrigin, methods: ['GET', 'POST', 'OPTIONS'] },
    schema: createSchema({
      typeDefs: `type Health { status: String!, service: String! } type Query { health: Health! }`,
      resolvers: {
        Query: { health: () => ({ status: 'ok', service: 'daybook-api' }) },
      },
    }),
    plugins: [
      {
        onRequest({ request, endResponse }) {
          const path = new URL(request.url).pathname;
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

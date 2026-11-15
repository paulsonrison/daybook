export async function GET() {
  try {
    const response = await fetch(
      new URL(
        '/health',
        process.env.GRAPHQL_SERVER_URL || 'http://127.0.0.1:4000',
      ),
      { cache: 'no-store', signal: AbortSignal.timeout(5000) },
    );
    return Response.json(
      { status: response.ok ? 'ok' : 'unavailable' },
      {
        status: response.ok ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}

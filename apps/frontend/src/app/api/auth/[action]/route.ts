import { backendProxy } from '@/lib/server/backend-proxy';
async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!['me', 'register', 'login', 'logout'].includes(action))
    return Response.json({ error: 'Not found.' }, { status: 404 });
  if ((request.method === 'GET') !== (action === 'me'))
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  return backendProxy(request, `/auth/${action}`);
}
export const GET = handle;
export const POST = handle;

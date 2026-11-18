import { backendProxy } from '@/lib/server/backend-proxy';
export async function GET(request: Request) {
  return backendProxy(request, '/operations/backups');
}

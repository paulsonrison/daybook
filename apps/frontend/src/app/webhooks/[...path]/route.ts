import { providerProxy } from '@/lib/server/provider-proxy';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return providerProxy(request, (await params).path);
}
export const POST = GET;

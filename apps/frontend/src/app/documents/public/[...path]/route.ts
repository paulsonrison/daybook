import { documentProxy } from '@/lib/server/document-proxy';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return documentProxy(
    request,
    `/documents/public/${path.map(encodeURIComponent).join('/')}`,
  );
}
export const HEAD = GET;

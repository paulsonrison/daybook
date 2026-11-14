import { documentProxy } from '@/lib/server/document-proxy';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;
  return documentProxy(
    request,
    `/documents/owner/${encodeURIComponent(documentId)}`,
  );
}
export const HEAD = GET;

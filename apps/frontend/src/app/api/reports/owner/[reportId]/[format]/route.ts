import { reportProxy } from '@/lib/server/report-proxy';

async function handle(
  request: Request,
  { params }: { params: Promise<{ reportId: string; format: string }> },
) {
  const { reportId, format } = await params;
  return reportProxy(
    request,
    `/reports/owner/${encodeURIComponent(reportId)}/${encodeURIComponent(format)}`,
  );
}
export const GET = handle;
export const HEAD = handle;

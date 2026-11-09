import { AgencyEntry } from '@/features/auth/agency-entry';
export default function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AgencyEntry>{children}</AgencyEntry>;
}

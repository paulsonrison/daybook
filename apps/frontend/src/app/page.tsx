import { AgencyEntry } from '@/features/auth/agency-entry';
import { AgencyOverview } from '@/features/operations/screens';
export default function Home() {
  return (
    <AgencyEntry>
      <AgencyOverview />
    </AgencyEntry>
  );
}

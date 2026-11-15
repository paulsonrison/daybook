import { BillSummary } from '@daybook/ui';

/** Exercises the public library from a Server Component with plain example data. */
export default function ServerPresentationPage() {
  return (
    <main>
      <h1>Server presentation example</h1>
      <BillSummary
        resident={{
          name: 'Example resident',
          reference: 'EXAMPLE',
          address: 'Example address',
        }}
        invoice="EXAMPLE-001"
        period="Example period"
        issued="2026-11-01"
        due="2026-11-15"
        status="Saved"
        lines={[
          {
            id: 'example',
            publication: 'Example publication',
            quantity: 1,
            rate: '10.00',
            amount: '10.00',
          },
        ]}
        totals={[{ label: 'Example total', amount: '10.00' }]}
      />
    </main>
  );
}

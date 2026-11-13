'use client';
import { useEffect, useState } from 'react';
import { makeAutoObservable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { MetricCard, Notification } from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
class CreditDashboardStore {
  count: number | null = null;
  error = '';
  private generation = 0;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  dispose() {
    this.generation++;
  }
  async load() {
    const generation = ++this.generation;
    try {
      const result = await graphqlRequest<{
        creditRiskSummary: { highRiskCount: number };
      }>('{creditRiskSummary{highRiskCount}}');
      runInAction(() => {
        if (generation === this.generation)
          this.count = result.creditRiskSummary.highRiskCount;
      });
    } catch (e) {
      runInAction(() => {
        if (generation === this.generation) this.error = (e as Error).message;
      });
    }
  }
}
export const CreditDashboard = observer(function CreditDashboard() {
  const [store] = useState(() => new CreditDashboardStore());
  useEffect(() => {
    void store.load();
    return store.dispose;
  }, [store]);
  return (
    <div className="db-stack">
      {store.error ? (
        <Notification
          tone="warning"
          title="Credit alerts unavailable"
          description={store.error}
        />
      ) : (
        <MetricCard
          title="Overdue credit alerts"
          value={store.count ?? 'Unknown'}
          loading={store.count === null}
        />
      )}{' '}
      {store.count !== null && store.count > 0 && (
        <Notification
          tone="warning"
          title={`${store.count} resident accounts exceed credit limits`}
          action={<Link href="/settings/credit">Review overdue accounts</Link>}
        />
      )}
    </div>
  );
});

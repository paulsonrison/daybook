'use client';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button } from '@daybook/ui';
import { StatusStore } from './status-store';
export const ServiceStatus = observer(function ServiceStatus() {
  const [store] = useState(() => new StatusStore());
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-semibold">API connection</h2>
      <p
        role="status"
        aria-live="polite"
        className={store.status === 'error' ? 'text-red-700' : 'text-slate-600'}
      >
        {store.message}
      </p>
      <Button onClick={store.check} loading={store.status === 'loading'}>
        Check connection
      </Button>
    </section>
  );
});

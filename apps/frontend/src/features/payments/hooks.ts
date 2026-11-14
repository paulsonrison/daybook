'use client';
import { useEffect, useState } from 'react';
import { PaymentsStore } from './store';
export function usePaymentsStore() {
  const [store] = useState(() => new PaymentsStore());
  useEffect(() => {
    store.resume();
    void store.load();
    return store.dispose;
  }, [store]);
  return store;
}

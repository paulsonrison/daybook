import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest } from '@/lib/graphql/client';
export class StatusStore {
  status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  message = 'Check the connection to your local API.';
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  async check() {
    this.status = 'loading';
    try {
      const data = await graphqlRequest<{
        health: { status: string; service: string };
      }>('{ health { status service } }');
      runInAction(() => {
        this.status = 'success';
        this.message = `${data.health.service}: ${data.health.status}`;
      });
    } catch {
      runInAction(() => {
        this.status = 'error';
        this.message =
          'API unavailable. Start the backend and check NEXT_PUBLIC_GRAPHQL_URL.';
      });
    }
  }
}

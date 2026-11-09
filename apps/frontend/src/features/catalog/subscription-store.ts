'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest } from '@/lib/graphql/client';
export interface Subscription {
  id: string;
  residentId: string;
  publicationId: string;
  cadence: string;
  startDate: string;
  endDate: string | null;
  weekdays: number[];
  quantity: number;
  status: string;
  version: number;
}
export interface Hold {
  id: string;
  residentId: string;
  subscriptionId: string | null;
  startDate: string;
  resumeDate: string | null;
  active: boolean;
  version: number;
}
export interface PriceRule {
  id: string;
  publicationId: string;
  startDate: string;
  endDate: string | null;
  weekdays: number[];
  price: string;
  active: boolean;
  version: number;
}
const query = `{subscriptions{id residentId publicationId cadence startDate endDate weekdays quantity status version} holds{id residentId subscriptionId startDate resumeDate active version} priceRules{id publicationId startDate endDate weekdays price active version}}`;
const mutations = {
  subscription:
    'mutation($input:SubscriptionInput!){saveSubscription(input:$input){id}}',
  hold: 'mutation($input:HoldInput!){setHold(input:$input){id}}',
  price: 'mutation($input:PriceRuleInput!){savePriceRule(input:$input){id}}',
};
export class SubscriptionStore {
  subscriptions: Subscription[] = [];
  holds: Hold[] = [];
  priceRules: PriceRule[] = [];
  state: 'loading' | 'ready' | 'error' = 'loading';
  error = '';
  saving = false;
  saveError = '';
  notice = '';
  private generation = 0;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  async load() {
    const generation = ++this.generation;
    this.state = 'loading';
    this.error = '';
    try {
      const data = await graphqlRequest<{
        subscriptions: Subscription[];
        holds: Hold[];
        priceRules: PriceRule[];
      }>(query);
      runInAction(() => {
        if (generation !== this.generation) return;
        Object.assign(this, data);
        this.state = 'ready';
      });
    } catch (error) {
      runInAction(() => {
        if (generation !== this.generation) return;
        this.state = 'error';
        this.error =
          error instanceof Error
            ? error.message
            : 'Unable to load subscriptions.';
      });
    }
  }
  async save(kind: keyof typeof mutations, input: Record<string, unknown>) {
    if (this.saving) return false;
    this.saving = true;
    this.saveError = '';
    this.notice = '';
    try {
      await graphqlRequest(mutations[kind], { input });
      await this.load();
      runInAction(() => {
        this.notice = 'Changes saved.';
      });
      return true;
    } catch (error) {
      runInAction(() => {
        this.saveError =
          error instanceof Error
            ? error.message
            : 'Unable to save. Your entered details are preserved.';
      });
      return false;
    } finally {
      runInAction(() => {
        this.saving = false;
      });
    }
  }
  dispose() {
    this.generation++;
  }
}

'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest } from '@/lib/graphql/client';
import type { Route, Territory } from '../operations/store';
export interface Publication {
  id: string;
  name: string;
  edition: string;
  kind: string;
  language: string;
  dispatch: string;
  frequency: string;
  publishingDays: number[];
  anchorDate: string | null;
  weekdayPrice: string;
  weekendPrice: string;
  procurementNetCost: string | null;
  active: boolean;
  version: number;
}
export interface Resident {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  sector: string;
  routeId: string;
  dropOrder: number;
  status: string;
  depositBalance: string;
  version: number;
}
interface Data {
  publications: Publication[];
  residents: Resident[];
  routes: Route[];
  territories: Territory[];
}
const query = `{publications{id name edition kind language dispatch frequency publishingDays anchorDate weekdayPrice weekendPrice procurementNetCost active version} residents{id code name address phone sector routeId dropOrder status depositBalance version} routes{id code name territoryId active version stops{id label door sequence residentId}} territories{id name sectors active}}`;
const mutations = {
  publication:
    'mutation($input:PublicationInput!){savePublication(input:$input){id}}',
  resident: 'mutation($input:ResidentInput!){saveResident(input:$input){id}}',
};
export class CatalogStore {
  publications: Publication[] = [];
  residents: Resident[] = [];
  routes: Route[] = [];
  territories: Territory[] = [];
  state: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  error = '';
  saveError = '';
  saving = false;
  private generation = 0;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  async load() {
    const generation = ++this.generation;
    this.state = 'loading';
    this.error = '';
    try {
      const data = await graphqlRequest<Data>(query);
      runInAction(() => {
        if (generation !== this.generation) return;
        Object.assign(this, data);
        this.state = 'ready';
      });
    } catch (error) {
      runInAction(() => {
        if (generation !== this.generation) return;
        this.error =
          error instanceof Error ? error.message : 'Unable to load records.';
        this.state = 'error';
      });
    }
  }
  async save(kind: keyof typeof mutations, input: Record<string, unknown>) {
    if (this.saving) return false;
    this.saving = true;
    this.saveError = '';
    try {
      await graphqlRequest(mutations[kind], { input });
      await this.load();
      return true;
    } catch (error) {
      runInAction(() => {
        this.saveError =
          error instanceof Error
            ? error.message
            : 'Unable to save. Your entered values are preserved.';
      });
      return false;
    } finally {
      runInAction(() => {
        this.saving = false;
      });
    }
  }
  clearSaveError() {
    this.saveError = '';
  }
  dispose() {
    this.generation++;
  }
}

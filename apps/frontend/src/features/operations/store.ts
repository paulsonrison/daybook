'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest } from '@/lib/graphql/client';
export interface Territory {
  id: string;
  name: string;
  locality: string;
  pinCodes: string[];
  sectors: string[];
  active: boolean;
  version: number;
}
export interface Staff {
  id: string;
  name: string;
  staffCode: string;
  phone: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';
  assignedSectors: string[];
  version: number;
}
export interface Stop {
  id?: string;
  label: string;
  door: string;
  sequence: number;
}
export interface Route {
  id: string;
  code: string;
  name: string;
  territoryId: string;
  staffId: string | null;
  staffName: string | null;
  active: boolean;
  version: number;
  stops: Stop[];
}
interface Data {
  territories: Territory[];
  staff: Staff[];
  routes: Route[];
  operationsSummary: {
    territories: number;
    activeStaff: number;
    activeRoutes: number;
  };
}
const query = `{territories{id name locality pinCodes sectors active version} staff{id name staffCode phone status assignedSectors version} routes{id code name territoryId staffId staffName active version stops{id label door sequence}} operationsSummary{territories activeStaff activeRoutes}}`;
const mutations = {
  territory:
    'mutation($input:TerritoryInput!){saveTerritory(input:$input){id}}',
  staff: 'mutation($input:StaffInput!){saveStaff(input:$input){id}}',
  route: 'mutation($input:RouteInput!){saveRoute(input:$input){id}}',
};
export class OperationsStore {
  territories: Territory[] = [];
  staff: Staff[] = [];
  routes: Route[] = [];
  summary: Data['operationsSummary'] = {
    territories: 0,
    activeStaff: 0,
    activeRoutes: 0,
  };
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
        this.territories = data.territories;
        this.staff = data.staff;
        this.routes = data.routes;
        this.summary = data.operationsSummary;
        this.state = 'ready';
      });
    } catch (error) {
      runInAction(() => {
        if (generation !== this.generation) return;
        this.error =
          error instanceof Error
            ? error.message
            : 'Unable to load agency records.';
        this.state = 'error';
      });
    }
  }
  clearSaveError() {
    this.saveError = '';
  }
  async save(
    kind: keyof typeof mutations,
    input: Record<string, unknown>,
  ): Promise<boolean> {
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
  dispose() {
    this.generation++;
  }
}

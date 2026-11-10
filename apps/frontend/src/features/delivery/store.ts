'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest } from '@/lib/graphql/client';
import type { Route, Staff } from '../operations/store';
import type { Publication } from '../catalog/store';
import { metricsFields, type DeliveryMetrics } from './metrics';
export interface Delivery {
  id: string;
  residentId: string;
  publicationId: string;
  routeId: string;
  staffId: string | null;
  residentName: string;
  address: string;
  publicationName: string;
  routeName: string;
  staffName: string | null;
  dropOrder: number;
  quantity: number;
  price: string;
  status: string;
  reason: string | null;
  version: number;
  dispatch: string;
}
export interface Complaint {
  id: string;
  deliveryId: string;
  kind: string;
  note: string;
  status: string;
  residentName: string;
  routeName: string;
  staffName: string | null;
  replacementCopies: number;
  credit: string;
  version: number;
}
export interface Assignment {
  id: string;
  routeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  active: boolean;
  version: number;
  allocations: { staffId: string; fromDrop: number; toDrop: number }[];
}
export interface Holiday {
  id: string;
  publicationId: string;
  date: string;
  reason: string;
  active: boolean;
  version: number;
}
export interface Manifest {
  id: string;
  date: string;
  dispatch: string;
  totalCopies: number;
  version: number;
  averageCopies: number | null;
  deviation: boolean;
  publications: { publicationId: string; name: string; copies: number }[];
  rows: {
    subscriptionId: string;
    residentId: string;
    publicationName: string;
    residentName: string;
    address: string;
    routeName: string;
    staffName: string | null;
    dropOrder: number;
    quantity: number;
  }[];
}
const query = `query($date:String!){deliveryMetrics{${metricsFields}} deliveryLogs(date:$date){id residentId publicationId routeId staffId residentName address publicationName routeName staffName dropOrder quantity price status reason version dispatch} manifests(date:$date){id date dispatch totalCopies version averageCopies deviation publications{publicationId name copies} rows{subscriptionId residentId publicationName residentName address routeName staffName dropOrder quantity}} complaints{id deliveryId kind note status residentName routeName staffName replacementCopies credit version} substituteAssignments{id routeId startDate endDate reason active version allocations{staffId fromDrop toDrop}} pressHolidays{id publicationId date reason active version} routes{id code name active territoryId version stops{id label door sequence}} staff{id name staffCode status} publications{id name edition active}}`;
interface Data {
  deliveryMetrics: DeliveryMetrics;
  deliveryLogs: Delivery[];
  manifests: Manifest[];
  complaints: Complaint[];
  substituteAssignments: Assignment[];
  pressHolidays: Holiday[];
  routes: Route[];
  staff: Staff[];
  publications: Publication[];
}
const mutations = {
  override:
    'mutation($input:DeliveryOverrideInput!){overrideDelivery(input:$input){id}}',
  complaint:
    'mutation($input:ComplaintInput!){recordComplaint(input:$input){id}}',
  resolution:
    'mutation($input:ComplaintResolutionInput!){resolveComplaint(input:$input){id}}',
  substitute:
    'mutation($input:SubstituteInput!){assignSubstitutes(input:$input){id}}',
  holiday:
    'mutation($input:PressHolidayInput!){savePressHoliday(input:$input){id}}',
};
export function defaultDeliveryDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export class DeliveryStore {
  date = defaultDeliveryDate();
  dispatch = 'MORNING';
  logs: Delivery[] = [];
  manifests: Manifest[] = [];
  complaints: Complaint[] = [];
  assignments: Assignment[] = [];
  holidays: Holiday[] = [];
  routes: Route[] = [];
  staff: Staff[] = [];
  publications: Publication[] = [];
  state: 'loading' | 'ready' | 'error' = 'loading';
  error = '';
  saveError = '';
  saving = false;
  notice = '';
  metrics: DeliveryMetrics | null = null;
  private dateSelected = false;
  private generation = 0;
  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  async load() {
    const generation = ++this.generation;
    this.state = 'loading';
    this.error = '';
    try {
      const data = await graphqlRequest<Data>(query, { date: this.date });
      runInAction(() => {
        if (generation !== this.generation) return;
        if (!this.dateSelected && this.date !== data.deliveryMetrics.today) {
          this.date = data.deliveryMetrics.today;
          this.dateSelected = true;
          void this.load();
          return;
        }
        this.dateSelected = true;
        this.metrics = data.deliveryMetrics;
        this.logs = data.deliveryLogs;
        this.manifests = data.manifests;
        this.complaints = data.complaints;
        this.assignments = data.substituteAssignments;
        this.holidays = data.pressHolidays;
        this.routes = data.routes;
        this.staff = data.staff;
        this.publications = data.publications;
        this.state = 'ready';
      });
    } catch (error) {
      runInAction(() => {
        if (generation !== this.generation) return;
        this.error =
          error instanceof Error ? error.message : 'Unable to load deliveries.';
        this.state = 'error';
      });
    }
  }
  setDate(date: string) {
    this.dateSelected = true;
    this.date = date;
    this.notice = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) void this.load();
  }
  setDispatch(dispatch: string) {
    this.dispatch = dispatch;
  }
  async execute(query: string, variables: Record<string, unknown>) {
    if (this.saving) return false;
    this.saving = true;
    this.saveError = '';
    this.notice = '';
    try {
      await graphqlRequest(query, variables);
      await this.load();
      runInAction(() => {
        this.notice = 'Changes saved.';
      });
      return true;
    } catch (error) {
      runInAction(() => {
        this.saveError =
          error instanceof Error ? error.message : 'Unable to confirm changes.';
      });
      return false;
    } finally {
      runInAction(() => {
        this.saving = false;
      });
    }
  }
  async generate() {
    return this.execute(
      'mutation($date:String!,$dispatch:DispatchTime!){buildManifest(date:$date,dispatch:$dispatch){id}}',
      { date: this.date, dispatch: this.dispatch },
    );
  }
  save(kind: keyof typeof mutations, input: Record<string, unknown>) {
    return this.execute(mutations[kind], { input });
  }
  clearSaveError() {
    this.saveError = '';
  }
  dispose() {
    this.generation++;
  }
}

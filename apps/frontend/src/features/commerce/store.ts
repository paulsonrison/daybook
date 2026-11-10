'use client';
import { makeAutoObservable, runInAction } from 'mobx';
import { graphqlRequest } from '@/lib/graphql/client';
export interface Publisher {
  id: string;
  name: string;
  phone: string;
  returnCutoff: string;
  returnWindowDays: number;
  active: boolean;
  version: number;
}
export interface Supply {
  id: string;
  publisherId: string;
  publicationId: string;
  date: string;
  quantity: number;
  publicationName: string;
  dispatch: string;
  netCost: string;
  totalCost: string;
  returnDeadline: string;
  returned: number;
}
export interface Item {
  id: string;
  name: string;
  sku: string;
  kind: string;
  price: string;
  onHand: number;
  reserved: number;
  available: number;
  active: boolean;
  version: number;
}
export interface Preorder {
  id: string;
  residentId: string;
  itemId: string;
  name: string;
  quantity: number;
  date: string;
  dispatch: string;
  unitPrice: string;
  total: string;
  settlement: string;
  status: string;
  version: number;
  receiptCode: string | null;
}
export interface Charge {
  id: string;
  orderId: string;
  residentId: string;
  amount: string;
  settlement: string;
  receiptCode: string | null;
  date: string;
}
export interface Advertiser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  billingAddress: string;
  active: boolean;
  version: number;
}
export interface InsertOrder {
  id: string;
  advertiserId: string;
  title: string;
  quantity: number;
  date: string;
  dispatch: string;
  unitPrice: string;
  total: string;
  status: string;
  version: number;
  allocations: { routeId: string; quantity: number }[];
}
export interface AdvertiserInvoice {
  id: string;
  orderId: string;
  advertiserId: string;
  code: string;
  advertiserName: string;
  billingAddress: string;
  subtotal: string;
  tax: string;
  total: string;
  proofReference: string;
  date: string;
}
export interface Statement {
  publisherId: string;
  month: string;
  supplied: number;
  returned: number;
  supplyCost: string;
  returnCredit: string;
  netPayable: string;
  rows: {
    publicationId: string;
    name: string;
    dispatch: string;
    supplied: number;
    returned: number;
    supplyCost: string;
    returnCredit: string;
    netPayable: string;
  }[];
}
interface Data {
  publishers: Publisher[];
  supplyLots: Supply[];
  supplyReturns: {
    id: string;
    supplyId: string;
    quantity: number;
    reason: string;
    credit: string;
    date: string;
  }[];
  merchandiseItems: Item[];
  merchandiseOrders: Preorder[];
  merchandiseCharges: Charge[];
  advertisers: Advertiser[];
  insertOrders: InsertOrder[];
  advertiserInvoices: AdvertiserInvoice[];
  residents: { id: string; name: string; code: string; status: string }[];
  publications: {
    id: string;
    name: string;
    edition: string;
    procurementNetCost: string | null;
    active: boolean;
  }[];
  routes: { id: string; name: string; code: string; active: boolean }[];
  deliveryMetrics: { today: string; timezone: string };
}
const query = `{publishers{id name phone returnCutoff returnWindowDays active version} supplyLots{id publisherId publicationId date quantity publicationName dispatch netCost totalCost returnDeadline returned} supplyReturns{id supplyId quantity reason credit date} merchandiseItems{id name sku kind price onHand reserved available active version} merchandiseOrders{id residentId itemId name quantity date dispatch unitPrice total settlement status version receiptCode} merchandiseCharges{id orderId residentId amount settlement receiptCode date} advertisers{id name phone email billingAddress active version} insertOrders{id advertiserId title quantity date dispatch unitPrice total status version allocations{routeId quantity}} advertiserInvoices{id orderId advertiserId code advertiserName billingAddress subtotal tax total proofReference date} residents{id name code status} publications{id name edition procurementNetCost active} routes{id name code active} deliveryMetrics{today timezone}}`;
const mutations = {
  publisher:
    'mutation($input:PublisherInput!){savePublisher(input:$input){id}}',
  supply: 'mutation($input:SupplyInput!){receiveSupply(input:$input){id}}',
  return: 'mutation($input:ReturnInput!){recordReturn(input:$input){id}}',
  item: 'mutation($input:MerchandiseInput!){saveMerchandise(input:$input){id}}',
  stock:
    'mutation($input:MerchandiseStockInput!){receiveMerchandiseStock(input:$input){id}}',
  preorder:
    'mutation($input:MerchandiseOrderInput!){saveMerchandiseOrder(input:$input){id}}',
  reserve:
    'mutation($input:MerchandiseReserveInput!){reserveMerchandise(input:$input){id}}',
  cancelPreorder:
    'mutation($input:MerchandiseReserveInput!){cancelMerchandiseOrder(input:$input){id}}',
  fulfil:
    'mutation($input:MerchandiseFulfilInput!){fulfilOrder(input:$input){id}}',
  advertiser:
    'mutation($input:AdvertiserInput!){saveAdvertiser(input:$input){id}}',
  insert:
    'mutation($input:InsertOrderInput!){saveInsertOrder(input:$input){id}}',
  cancelInsert:
    'mutation($input:InsertActionInput!){cancelInsertOrder(input:$input){id}}',
  completeInsert:
    'mutation($input:InsertCompleteInput!){completeInsertOrder(input:$input){id}}',
};
export type CommerceMutation = keyof typeof mutations;
export class CommerceStore {
  publishers: Publisher[] = [];
  supplies: Supply[] = [];
  returns: Data['supplyReturns'] = [];
  items: Item[] = [];
  orders: Preorder[] = [];
  charges: Charge[] = [];
  advertisers: Advertiser[] = [];
  inserts: InsertOrder[] = [];
  invoices: AdvertiserInvoice[] = [];
  residents: Data['residents'] = [];
  publications: Data['publications'] = [];
  routes: Data['routes'] = [];
  today = '';
  timezone = 'Asia/Kolkata';
  state: 'loading' | 'ready' | 'error' = 'loading';
  error = '';
  saveError = '';
  saving = false;
  notice = '';
  statement: Statement | null = null;
  statementError = '';
  statementLoading = false;
  private generation = 0;
  private statementGeneration = 0;
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
        this.publishers = data.publishers;
        this.supplies = data.supplyLots;
        this.returns = data.supplyReturns;
        this.items = data.merchandiseItems;
        this.orders = data.merchandiseOrders;
        this.charges = data.merchandiseCharges;
        this.advertisers = data.advertisers;
        this.inserts = data.insertOrders;
        this.invoices = data.advertiserInvoices;
        this.residents = data.residents;
        this.publications = data.publications;
        this.routes = data.routes;
        this.today = data.deliveryMetrics.today;
        this.timezone = data.deliveryMetrics.timezone;
        this.state = 'ready';
      });
    } catch (error) {
      runInAction(() => {
        if (generation !== this.generation) return;
        this.error =
          error instanceof Error
            ? error.message
            : 'Unable to load agency stock and trade records.';
        this.state = 'error';
      });
    }
  }
  clearSaveError() {
    this.saveError = '';
  }
  async save(kind: CommerceMutation, input: Record<string, unknown>) {
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
            : 'Unable to confirm changes. Your entered values are preserved.';
      });
      return false;
    } finally {
      runInAction(() => {
        this.saving = false;
      });
    }
  }
  async loadStatement(publisherId: string, month: string) {
    const generation = ++this.statementGeneration;
    this.statementLoading = true;
    this.statementError = '';
    this.statement = null;
    try {
      const data = await graphqlRequest<{ publisherStatement: Statement }>(
        `query($publisherId:ID!,$month:String!){publisherStatement(publisherId:$publisherId,month:$month){publisherId month supplied returned supplyCost returnCredit netPayable rows{publicationId name dispatch supplied returned supplyCost returnCredit netPayable}}}`,
        { publisherId, month },
      );
      runInAction(() => {
        if (generation === this.statementGeneration)
          this.statement = data.publisherStatement;
      });
    } catch (error) {
      runInAction(() => {
        if (generation === this.statementGeneration)
          this.statementError =
            error instanceof Error ? error.message : 'Statement unavailable.';
      });
    } finally {
      runInAction(() => {
        if (generation === this.statementGeneration)
          this.statementLoading = false;
      });
    }
  }
  dispose() {
    this.generation++;
    this.statementGeneration++;
  }
}

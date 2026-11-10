'use client';
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Checkbox, Field, Select, formatMoney } from '@daybook/ui';
import { Editor } from '../operations/editors';
import {
  type Advertiser,
  type CommerceMutation,
  type CommerceStore,
  type InsertOrder,
  type Item,
  type Preorder,
  type Publisher,
  type Supply,
} from './store';
export type EditorKind = Exclude<CommerceMutation, 'reserve'>;
export type CommerceRecord =
  Publisher | Supply | Item | Preorder | Advertiser | InsertOrder;
const labels: Record<EditorKind, [string, string]> = {
  publisher: ['Publisher', 'Save publisher'],
  supply: ['Receive publisher supply', 'Save supply'],
  return: ['Record publisher return', 'Save return'],
  item: ['Seasonal item', 'Save item'],
  stock: ['Receive seasonal stock', 'Save stock receipt'],
  preorder: ['New seasonal preorder', 'Save preorder'],
  cancelPreorder: ['Cancel seasonal preorder', 'Cancel preorder'],
  fulfil: ['Confirm seasonal delivery', 'Confirm fulfilment'],
  advertiser: ['Advertiser', 'Save advertiser'],
  insert: ['Schedule targeted inserts', 'Save insert order'],
  cancelInsert: ['Cancel insert campaign', 'Cancel campaign'],
  completeInsert: ['Complete insertion order', 'Issue advertiser invoice'],
};
function initial(
  kind: EditorKind,
  record: CommerceRecord | null,
  store: CommerceStore,
): Record<string, string | boolean> {
  const r = record as unknown as Record<string, unknown> | null,
    value = (key: string, fallback = '') =>
      r?.[key] === undefined || r?.[key] === null ? fallback : String(r[key]);
  switch (kind) {
    case 'publisher':
      return {
        name: value('name'),
        phone: value('phone'),
        returnCutoff: value('returnCutoff'),
        returnWindowDays: value('returnWindowDays', '0'),
        active: r?.active !== false,
      };
    case 'supply':
      return {
        publisherId: '',
        publicationId: '',
        date: store.today,
        quantity: '1',
        costMode: 'CATALOG',
        netCost: '',
        listPrice: '',
        marginPercent: '',
      };
    case 'return':
      return { quantity: '1', reason: '' };
    case 'item':
      return {
        name: value('name'),
        sku: value('sku'),
        kind: value('kind', 'CALENDAR'),
        price: value('price', '0.00'),
        active: r?.active !== false,
      };
    case 'stock':
      return { quantity: '1', note: '' };
    case 'preorder':
      return {
        residentId: '',
        itemId: '',
        quantity: '1',
        date: store.today,
        dispatch: 'MORNING',
        settlement: 'INVOICE',
      };
    case 'fulfil':
      return { cashReceived: '' };
    case 'advertiser':
      return {
        name: value('name'),
        phone: value('phone'),
        email: value('email'),
        billingAddress: value('billingAddress'),
        active: r?.active !== false,
      };
    case 'insert':
      return {
        advertiserId: value('advertiserId'),
        title: value('title'),
        quantity: value('quantity', '1'),
        date: value('date', store.today),
        dispatch: value('dispatch', 'MORNING'),
        unitPrice: value('unitPrice', '0.00'),
      };
    case 'completeInsert':
      return { proofReference: '', noTaxConfirmed: false };
    default:
      return {};
  }
}
export const CommerceEditor = observer(function CommerceEditor({
  kind,
  record,
  store,
  onClose,
}: {
  kind: EditorKind;
  record: CommerceRecord | null;
  store: CommerceStore;
  onClose: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID()),
    [d, setDraft] = useState(() => initial(kind, record, store)),
    [allocations, setAllocations] = useState(() =>
      kind === 'insert' && record
        ? (record as InsertOrder).allocations.map((a) => ({ ...a }))
        : [{ routeId: '', quantity: 1 }],
    );
  const change = (key: string, value: string | boolean) =>
      setDraft((d) => ({ ...d, [key]: value })),
    text = (key: string) => String(d[key] ?? '');
  function field(
    label: string,
    key: string,
    type = 'text',
    required = true,
    maxLength?: number,
  ) {
    return (
      <Field
        label={label}
        type={type}
        value={text(key)}
        onChange={(e) => change(key, e.target.value)}
        required={required}
        maxLength={maxLength}
        min={type === 'number' ? 1 : undefined}
        step={type === 'number' ? 1 : undefined}
      />
    );
  }
  function select(
    label: string,
    key: string,
    options: { value: string; label: string }[],
    required = true,
  ) {
    return (
      <Select
        label={label}
        value={text(key)}
        onChange={(e) => change(key, e.target.value)}
        options={options}
        required={required}
      />
    );
  }
  const choose = (label: string, rows: { id: string; name: string }[]) => [
    { value: '', label },
    ...rows.map((r) => ({ value: r.id, label: r.name })),
  ];
  const dispatch = () =>
    select('Dispatch', 'dispatch', [
      { value: 'MORNING', label: 'Morning' },
      { value: 'EVENING', label: 'Evening' },
    ]);
  function input() {
    const base = {
      id: record?.id,
      version: record && 'version' in record ? record.version : undefined,
    };
    switch (kind) {
      case 'publisher':
        return { ...base, ...d, returnWindowDays: Number(d.returnWindowDays) };
      case 'supply':
        return {
          requestId,
          publisherId: d.publisherId,
          publicationId: d.publicationId,
          date: d.date,
          quantity: Number(d.quantity),
          ...(d.costMode === 'NET'
            ? { netCost: d.netCost }
            : d.costMode === 'LIST'
              ? { listPrice: d.listPrice, marginPercent: d.marginPercent }
              : {}),
        };
      case 'return':
        return {
          requestId,
          supplyId: record!.id,
          quantity: Number(d.quantity),
          reason: d.reason,
        };
      case 'item':
        return { ...base, ...d };
      case 'stock':
        return {
          requestId,
          itemId: record!.id,
          quantity: Number(d.quantity),
          note: d.note,
        };
      case 'preorder':
        return { requestId, ...d, quantity: Number(d.quantity) };
      case 'fulfil':
        return {
          requestId,
          orderId: record!.id,
          version: (record as Preorder).version,
          ...((record as Preorder).settlement === 'CASH'
            ? { cashReceived: d.cashReceived }
            : {}),
        };
      case 'advertiser':
        return { ...base, ...d, email: d.email || null };
      case 'insert':
        return {
          ...base,
          requestId,
          ...d,
          quantity: Number(d.quantity),
          allocations,
        };
      case 'completeInsert':
        return {
          requestId,
          orderId: record!.id,
          version: (record as InsertOrder).version,
          ...d,
        };
      default:
        return {
          requestId,
          orderId: record!.id,
          version: (record as Preorder | InsertOrder).version,
        };
    }
  }
  return (
    <Editor
      title={labels[kind][0]}
      label={labels[kind][1]}
      store={store}
      onClose={onClose}
      onSave={async () => {
        if (await store.save(kind, input())) onClose();
      }}
    >
      {kind === 'publisher' && (
        <>
          {field('Publisher name', 'name', 'text', true, 120)}
          {field('Phone', 'phone', 'tel', true, 30)}
          {field('Return cutoff', 'returnCutoff', 'time')}
          <Field
            label="Return window days"
            type="number"
            min={0}
            max={31}
            required
            value={text('returnWindowDays')}
            onChange={(e) => change('returnWindowDays', e.target.value)}
            hint="Days after the supplied issue date; cutoff uses the agency timezone."
          />
          <Checkbox
            label="Publisher active"
            checked={Boolean(d.active)}
            onChange={(e) => change('active', e.target.checked)}
          />
        </>
      )}
      {kind === 'supply' && (
        <>
          {select(
            'Publisher',
            'publisherId',
            choose(
              'Choose publisher',
              store.publishers.filter((p) => p.active),
            ),
          )}
          {select(
            'Publication',
            'publicationId',
            choose(
              'Choose publication',
              store.publications
                .filter((p) => p.active)
                .map((p) => ({ id: p.id, name: `${p.name} · ${p.edition}` })),
            ),
          )}
          {field('Supply date', 'date', 'date')}
          {field('Received copies', 'quantity', 'number')}
          {select('Procurement method', 'costMode', [
            { value: 'CATALOG', label: 'Use catalog net cost' },
            { value: 'NET', label: 'Enter net cost' },
            { value: 'LIST', label: 'List price and trade margin' },
          ])}
          {d.costMode === 'NET' && field('Net unit cost', 'netCost')}
          {d.costMode === 'LIST' && (
            <>
              {field('Publisher list price', 'listPrice')}
              {field('Trade margin percent', 'marginPercent')}
            </>
          )}
          <p className="db-muted">
            Net cost already includes the publisher margin. A return retains
            this lot&apos;s cost and cutoff.
          </p>
        </>
      )}
      {kind === 'return' && (
        <>
          <p>
            {(record as Supply).publicationName} ·{' '}
            {formatMoney((record as Supply).netCost)} per returned copy
          </p>
          <p className="db-muted">
            {(record as Supply).quantity - (record as Supply).returned} copies
            remain eligible. Cutoff:{' '}
            {new Date((record as Supply).returnDeadline).toLocaleString(
              'en-IN',
              { timeZone: store.timezone },
            )}
            .
          </p>
          {field('Returned copies', 'quantity', 'number')}
          {field('Return reason', 'reason', 'text', true, 500)}
        </>
      )}
      {kind === 'item' && (
        <>
          {field('Item name', 'name', 'text', true, 120)}
          {field('Stock code', 'sku', 'text', true, 40)}
          {select('Item type', 'kind', [
            { value: 'CALENDAR', label: 'Calendar' },
            { value: 'DIARY', label: 'Annual diary' },
            { value: 'FESTIVAL', label: 'Festival special' },
            { value: 'OTHER', label: 'Other seasonal item' },
          ])}
          {field('Retail price', 'price')}
          <Checkbox
            label="Seasonal item active"
            checked={Boolean(d.active)}
            onChange={(e) => change('active', e.target.checked)}
          />
        </>
      )}
      {kind === 'stock' && (
        <>
          <p>{(record as Item).name}</p>
          {field('Received quantity', 'quantity', 'number')}
          {field('Stock receipt note', 'note', 'text', true, 500)}
        </>
      )}
      {kind === 'preorder' && (
        <>
          {select(
            'Resident',
            'residentId',
            choose(
              'Choose resident',
              store.residents.filter((r) => r.status === 'ACTIVE'),
            ),
          )}
          {select(
            'Seasonal item',
            'itemId',
            choose(
              'Choose seasonal item',
              store.items.filter((i) => i.active),
            ),
          )}
          {field('Order quantity', 'quantity', 'number')}
          {field('Scheduled drop date', 'date', 'date')}
          {dispatch()}
          {select('Settlement', 'settlement', [
            { value: 'INVOICE', label: 'Add to resident invoice' },
            { value: 'CASH', label: 'Collect cash on fulfilment' },
          ])}
          <p className="db-muted">
            The agreed item price is saved with the preorder. Reserve available
            stock before dispatch.
          </p>
        </>
      )}
      {kind === 'fulfil' && (
        <>
          <p>
            Confirm that {(record as Preorder).quantity} ×{' '}
            {(record as Preorder).name} were handed over.
          </p>
          <strong>Total: {formatMoney((record as Preorder).total)}</strong>
          {(record as Preorder).settlement === 'CASH' ? (
            field('Cash received', 'cashReceived')
          ) : (
            <p className="db-muted">
              This charge will appear once on the resident invoice.
            </p>
          )}
        </>
      )}
      {kind === 'advertiser' && (
        <>
          {field('Advertiser name', 'name', 'text', true, 120)}
          {field('Phone', 'phone', 'tel', true, 30)}
          {field('Email', 'email', 'email', false, 254)}
          {field('Billing address', 'billingAddress', 'text', true, 500)}
          <Checkbox
            label="Advertiser active"
            checked={Boolean(d.active)}
            onChange={(e) => change('active', e.target.checked)}
          />
        </>
      )}
      {kind === 'insert' && (
        <>
          {select(
            'Advertiser',
            'advertiserId',
            choose(
              'Choose advertiser',
              store.advertisers.filter((a) => a.active),
            ),
          )}
          {field('Campaign title', 'title', 'text', true, 160)}
          {field('Total insert copies', 'quantity', 'number')}
          {field('Scheduled drop date', 'date', 'date')}
          {dispatch()}
          {field('Price per insert', 'unitPrice')}
          <p className="db-muted">
            Allocate one insert to each scheduled household. Route quantities
            must equal the order total.
          </p>
          {allocations.map((a, index) => (
            <div className="agency-stop-editor" key={index}>
              <Select
                label={`Target route ${index + 1}`}
                required
                value={a.routeId}
                options={choose(
                  'Choose target route',
                  store.routes.filter((r) => r.active),
                )}
                onChange={(e) =>
                  setAllocations((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, routeId: e.target.value } : row,
                    ),
                  )
                }
              />
              <Field
                label={`Insert copies ${index + 1}`}
                type="number"
                min={1}
                required
                value={a.quantity}
                onChange={(e) =>
                  setAllocations((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? { ...row, quantity: Number(e.target.value) }
                        : row,
                    ),
                  )
                }
              />
              {allocations.length > 1 && (
                <Button
                  variant="tertiary"
                  onClick={() =>
                    setAllocations((rows) => rows.filter((_, i) => i !== index))
                  }
                >
                  Remove target route {index + 1}
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={allocations.length >= 100}
            onClick={() =>
              setAllocations((rows) => [...rows, { routeId: '', quantity: 1 }])
            }
          >
            Add target route
          </Button>
        </>
      )}
      {kind === 'completeInsert' && (
        <>
          <p>
            {(record as InsertOrder).title} · {(record as InsertOrder).quantity}{' '}
            copies · {formatMoney((record as InsertOrder).total)}
          </p>
          {field(
            'Completion proof reference',
            'proofReference',
            'text',
            true,
            1000,
          )}
          <p className="db-muted">
            Record a signed delivery slip, photo reference, or recipient
            acknowledgement. The complete allocation must be present in the
            packing manifest.
          </p>
          <Checkbox
            label="Confirm no tax applies"
            required
            checked={Boolean(d.noTaxConfirmed)}
            onChange={(e) => change('noTaxConfirmed', e.target.checked)}
          />
          <p className="db-muted">
            Confirm the applicable tax treatment before issuing the advertiser
            invoice.
          </p>
        </>
      )}
      {(kind === 'cancelPreorder' || kind === 'cancelInsert') && (
        <p>
          Cancel this uncompleted order? Reserved seasonal stock will become
          available again.
        </p>
      )}
    </Editor>
  );
});

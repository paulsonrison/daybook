import type { ReactNode } from 'react';
import { formatMoney } from '../utils';
import { Badge, Card, StatusBadge } from './card';
import { Button } from './button';
import { DataTable } from './data-table';
import { DataState, Notification, TableSkeleton } from './feedback';
import { Icon } from './icon';
export interface BillLine {
  id: string;
  publication: string;
  quantity: number | null;
  rate: number | string | null;
  amount: number | string | null;
}
export interface BillSummaryProps {
  resident: { name: string; reference: string; address: string };
  invoice: string;
  period: string;
  issued: string;
  due: string;
  status: 'Draft' | 'Saved' | 'Paid' | 'Unpaid' | 'Overdue';
  lines: readonly BillLine[];
  totals: readonly { label: string; amount: number | string | null }[];
  note?: string;
  state?: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
  currency?: string;
  footer?: ReactNode;
}
/** All amounts and statuses are supplied by the application's confirmed data. */
export function BillSummary({
  resident,
  invoice,
  period,
  issued,
  due,
  status,
  lines,
  totals,
  note,
  state = 'ready',
  onRetry,
  currency = 'INR',
  footer,
}: BillSummaryProps) {
  if (state === 'loading')
    return <TableSkeleton label="Loading bill details…" rows={5} columns={4} />;
  if (state === 'error')
    return (
      <DataState
        kind="error"
        title="Bill unavailable"
        description="Your draft is preserved. No saved invoice was confirmed."
        onRetry={onRetry}
      />
    );
  return (
    <Card className="db-bill" footer={footer}>
      <div className="db-stack">
        <header className="db-bill-header">
          <div>
            <p className="db-eyebrow">Bill to · {resident.reference}</p>
            <h3 className="db-bill-name">{resident.name}</h3>
            <p className="db-bill-meta">{resident.address}</p>
          </div>
          <div className="db-stack" style={{ alignItems: 'flex-end', gap: 8 }}>
            <StatusBadge status={status} />
            <strong>{invoice}</strong>
            <p className="db-bill-meta">
              Issued {issued} · Due {due}
            </p>
          </div>
        </header>
        <div className="db-row" style={{ justifyContent: 'space-between' }}>
          <strong>{period}</strong>
          <span className="db-bill-meta">
            Actual delivered copies · {currency}
          </span>
        </div>
        {lines.length === 0 ? (
          <Notification
            title="No current deliveries"
            description="Previous balances and account credits still apply."
          />
        ) : (
          <DataTable
            caption="Publication and delivery details"
            rows={lines}
            rowKey={(line) => line.id}
            columns={[
              {
                key: 'publication',
                header: 'Publication / delivery',
                render: (line) => line.publication,
              },
              {
                key: 'quantity',
                header: 'Qty',
                align: 'right',
                render: (line) => line.quantity ?? 'Unavailable',
              },
              {
                key: 'rate',
                header: `Rate ${currency === 'INR' ? '₹' : currency}`,
                align: 'right',
                render: (line) =>
                  line.rate === null
                    ? 'Rate required'
                    : typeof line.rate === 'string'
                      ? line.rate
                      : line.rate.toFixed(2),
              },
              {
                key: 'amount',
                header: `Amount ${currency === 'INR' ? '₹' : currency}`,
                align: 'right',
                render: (line) =>
                  line.amount === null
                    ? 'Unavailable'
                    : typeof line.amount === 'string'
                      ? line.amount
                      : line.amount.toFixed(2),
              },
            ]}
          />
        )}
        {note && <p className="db-bill-meta">{note}</p>}
        <div className="db-bill-totals">
          {totals.map((total, index) => (
            <div key={`${total.label}-${index}`} className="db-bill-total-row">
              <span>{total.label}</span>
              <span>{formatMoney(total.amount, currency)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
export interface PaymentConfirmationProps {
  receipt?: string;
  status: 'confirmed' | 'checking' | 'unknown' | 'partial' | 'duplicate';
  amount: number | string | null;
  remaining?: number | string | null;
  invoice: string;
  description?: string;
  method?: string;
  recordedAt?: string;
  onReceipt?: () => void;
  onNext?: () => void;
  onCheckStatus?: () => void;
}
export function PaymentConfirmation({
  receipt,
  status,
  amount,
  remaining,
  invoice,
  description,
  method,
  recordedAt,
  onReceipt,
  onNext,
  onCheckStatus,
}: PaymentConfirmationProps) {
  if (status === 'checking')
    return (
      <DataState
        kind="loading"
        title="Checking payment status…"
        description="The bill remains unpaid until confirmation returns."
      />
    );
  if (status === 'unknown')
    return (
      <DataState
        kind="slow"
        title="Payment not confirmed"
        description="The payment may already be recorded. Check the original request before allowing a new payment."
        onRetry={onCheckStatus}
        retryLabel="Check payment status"
      />
    );
  const title =
    status === 'partial'
      ? 'Partial payment recorded'
      : status === 'duplicate'
        ? 'Receipt already recorded'
        : 'Payment recorded';
  return (
    <Card className="db-confirmation">
      <div role="status">
        <span className="db-confirmation-icon">
          <Icon name="paid" size={32} />
        </span>
        <h3>{title}</h3>
        {description && (
          <p className="db-confirmation-description">{description}</p>
        )}
        <div
          className="db-stack"
          style={{ alignItems: 'center', gap: 12, marginTop: 20 }}
        >
          <Badge tone={status === 'partial' ? 'warning' : 'success'}>
            {status === 'partial' ? 'Partial' : 'Paid'}
          </Badge>
          <strong className="db-metric">{formatMoney(amount)}</strong>
        </div>
      </div>
      <dl style={{ margin: '24px 0 32px', gap: 10 }} className="db-stack">
        {receipt && (
          <div className="db-bill-total-row">
            <dt>Receipt</dt>
            <dd style={{ margin: 0 }}>{receipt}</dd>
          </div>
        )}
        {invoice && (
          <div className="db-bill-total-row">
            <dt>Invoice</dt>
            <dd style={{ margin: 0 }}>{invoice}</dd>
          </div>
        )}
        {(method || recordedAt) && (
          <div className="db-bill-total-row">
            <dt>{method}</dt>
            <dd style={{ margin: 0 }}>{recordedAt}</dd>
          </div>
        )}
        <div className="db-bill-total-row">
          <dt>Balance remaining</dt>
          <dd style={{ margin: 0 }}>{formatMoney(remaining)}</dd>
        </div>
      </dl>
      <div className="db-row db-no-print">
        {onReceipt && (
          <Button variant="secondary" onClick={onReceipt}>
            <Icon name="print" size={16} />
            Print receipt
          </Button>
        )}
        {onNext && (
          <Button onClick={onNext}>
            Move to next
            <Icon name="next" size={16} />
          </Button>
        )}
      </div>
    </Card>
  );
}
export function NextRecord({
  name,
  description,
  context,
  state = 'ready',
  onNext,
  onSummary,
  skipped = 0,
}: {
  name?: string;
  description?: string;
  context: string;
  state?: 'ready' | 'loading' | 'end' | 'removed';
  onNext?: () => void;
  onSummary?: () => void;
  skipped?: number;
}) {
  if (state === 'loading') return <TableSkeleton rows={1} />;
  const ended = state === 'end' || state === 'removed';
  return (
    <Card className="db-next-record-card">
      <div className="db-next-record">
        <div>
          <p className="db-eyebrow">Next in delivery order</p>
          <h3 className="db-card-title" style={{ marginBlock: 8 }}>
            {state === 'end'
              ? 'End of this delivery order'
              : state === 'removed'
                ? 'Resident no longer on this route'
                : (name ?? 'Next resident unavailable')}
          </h3>
          {description && <p>{description}</p>}
          <p className="db-field-hint">{context}</p>
        </div>
        {ended ? (
          <Button variant="secondary" onClick={onSummary} disabled={!onSummary}>
            View route summary
          </Button>
        ) : (
          <Button onClick={onNext} disabled={!onNext || !name}>
            Move to next
            <Icon name="next" size={24} />
          </Button>
        )}
      </div>
      {skipped > 0 && (
        <Notification
          tone="warning"
          title={`${skipped} skipped accounts remain unpaid`}
          description="Review them before closing the run."
        />
      )}
    </Card>
  );
}

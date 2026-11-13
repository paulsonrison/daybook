'use client';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  DataState,
  Notification,
  formatMoney,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import type { PaymentsStore } from '../payments/store';
import { FinanceForm } from './forms';
type Records = {
  rules: {
    id: string;
    startDate: string;
    endDate: string | null;
    employmentEnd: string | null;
    mode: string;
    monthlySalary: string;
    copyRate: string;
    routeAllowance: string;
    proration: string;
  }[];
  attendance: { id: string; date: string; status: string; note: string }[];
  funds: {
    id: string;
    date: string;
    kind: string;
    amount: string;
    remaining: string;
    method: string;
    evidence: string;
  }[];
  adjustments: { id: string; date: string; amount: string; reason: string }[];
};
export const PayrollRecords = observer(function PayrollRecords({
  store,
  staffId,
  disabled,
}: {
  store: PaymentsStore;
  staffId: string;
  disabled: boolean;
}) {
  const [records, setRecords] = useState<Records | null>(null),
    [error, setError] = useState(''),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    if (store.busy) return;
    void graphqlRequest<{ payrollRecords: Records }>(
      'query($staff:ID!){payrollRecords(staffId:$staff){rules{id startDate endDate employmentEnd mode monthlySalary copyRate routeAllowance proration} attendance{id date status note} funds{id date kind amount remaining method evidence} adjustments{id date amount reason}}}',
      { staff: staffId },
    )
      .then((d) => {
        if (live) {
          setRecords(d.payrollRecords);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [staffId, store.busy, epoch]);
  return (
    <Card>
      <h2>Pay rules and staff history</h2>
      {error && (
        <Notification
          tone="error"
          title="Staff history unavailable"
          description={error}
          action={
            <Button onClick={() => setEpoch((v) => v + 1)}>
              Retry staff history
            </Button>
          }
        />
      )}
      {!records ? (
        <DataState kind="loading" title="Loading staff history" />
      ) : (
        <div className="db-stack">
          <h3>Effective pay rules</h3>
          {!records.rules.length ? (
            <p>No configured pay rule. Pay remains unknown.</p>
          ) : (
            records.rules.map((r) => (
              <article key={r.id}>
                <p>
                  {r.startDate} to {r.endDate ?? 'ongoing'} ·{' '}
                  {r.mode.replaceAll('_', ' ')} · Salary{' '}
                  {formatMoney(r.monthlySalary)} · Per copy{' '}
                  {formatMoney(r.copyRate)} · Route/day{' '}
                  {formatMoney(r.routeAllowance)}
                </p>
                <p>
                  {r.proration === 'CALENDAR_DAYS'
                    ? 'Calendar-day proration; unpaid absence excluded'
                    : 'Fixed monthly salary without automatic proration'}
                </p>
                {!r.employmentEnd && (
                  <FinanceForm
                    store={store}
                    operation="endPayRule"
                    label="End pay rule"
                    disabled={disabled || Boolean(error)}
                    base={{ ruleId: r.id }}
                    fields={[
                      {
                        key: 'endDate',
                        label: 'Pay rule final date',
                        type: 'date',
                      },
                      { key: 'reason', label: 'Reason for ending pay rule' },
                      {
                        key: 'endEmployment',
                        label: 'This also confirms final employment ended',
                        type: 'checkbox',
                      },
                    ]}
                  />
                )}
              </article>
            ))
          )}
          <h3>Attendance history</h3>
          {!records.attendance.length ? (
            <p>No attendance recorded.</p>
          ) : (
            records.attendance.map((a) => (
              <p key={a.id}>
                {a.date} · {a.status.replaceAll('_', ' ')} · {a.note}
              </p>
            ))
          )}
          <h3>Advances and unpaid expense claims</h3>
          {!records.funds.length ? (
            <p>No advances or expense claims.</p>
          ) : (
            records.funds.map((f) => (
              <p key={f.id}>
                {f.date} ·{' '}
                {f.kind === 'ADVANCE'
                  ? 'Confirmed advance'
                  : 'Approved unpaid expense'}{' '}
                · {formatMoney(f.amount)} · Remaining to apply{' '}
                {formatMoney(f.remaining)} · {f.evidence}
              </p>
            ))
          )}
          <h3>Explicit earnings corrections</h3>
          {!records.adjustments.length ? (
            <p>No earnings corrections.</p>
          ) : (
            records.adjustments.map((a) => (
              <p key={a.id}>
                {a.date} · {formatMoney(a.amount)} · {a.reason}
              </p>
            ))
          )}
          <FinanceForm
            key={staffId}
            store={store}
            operation="payrollAdjustment"
            label="Approve payroll correction"
            disabled={disabled || Boolean(error)}
            base={{ staffId }}
            fields={[
              {
                key: 'direction',
                label: 'Payroll correction direction',
                value: 'CREDIT',
                options: [
                  { value: 'CREDIT', label: 'Additional earnings' },
                  { value: 'DEBIT', label: 'Explicit approved deduction' },
                ],
              },
              { key: 'amount', label: 'Payroll correction amount' },
              {
                key: 'reason',
                label: 'Payroll correction approval reason',
                hint: 'Explain the original period and correction. Cash shortages do not create deductions automatically.',
              },
            ]}
          />
        </div>
      )}
    </Card>
  );
});
export function PayslipDetails({ snapshot }: { snapshot: string }) {
  const p = JSON.parse(snapshot) as {
    first: string;
    last: string;
    salary: string;
    commission: string;
    routeAllowance: string;
    adjustment?: string;
    advance: string;
    reimbursement: string;
    missingDays: number;
    missingPreparedDays: number;
    segments: {
      employedDays: number;
      paidDays: number;
      salary: string;
      copies: number;
      workedRoutes: number;
      proration: string;
    }[];
  };
  return (
    <details>
      <summary>Pay calculation and recorded inputs</summary>
      <div className="db-stack">
        <p>
          {p.first} to {p.last}
        </p>
        <dl>
          {(
            [
              ['Salary', p.salary],
              ['Delivery commission', p.commission],
              ['Route allowance', p.routeAllowance],
              ['Approved correction', p.adjustment ?? '0.00'],
              ['Advance applied', p.advance],
              ['Unpaid expenses reimbursed', p.reimbursement],
            ] as const
          ).map(([label, amount]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatMoney(amount)}</dd>
            </div>
          ))}
        </dl>
        {p.segments.map((s, index) => (
          <p key={index}>
            {s.employedDays} employed days, {s.paidDays} paid days, {s.copies}{' '}
            original fulfilled copies and {s.workedRoutes} worked route days.
            Salary segment: {formatMoney(s.salary)} (
            {s.proration === 'CALENDAR_DAYS'
              ? 'calendar-day proration'
              : 'fixed month'}
            ).
          </p>
        ))}
        <p>
          At posting: {p.missingDays} missing attendance days;{' '}
          {p.missingPreparedDays} missing preparation days, acknowledged by the
          owner.
        </p>
      </div>
    </details>
  );
}
export type CashHistory = {
  handovers: {
    id: string;
    staffId: string;
    routeId: string;
    date: string;
    postingDate: string;
    expected: string;
    actual: string;
    discrepancy: string;
    outstanding: string;
    returnedCopies: number;
    signoff: string;
  }[];
  closes: {
    id: string;
    date: string;
    opening: string;
    expected: string;
    counted: string;
    bankDeposit: string;
    variance: string;
    reason: string;
    signoff: string;
  }[];
  movements: {
    id: string;
    date: string;
    kind: string;
    amount: string;
    handoverId: string | null;
    reason: string;
  }[];
};
export function CashHistoryRecords({
  history,
  staff,
  routes,
}: {
  history: CashHistory;
  staff: { id: string; name: string }[];
  routes: { id: string; name: string }[];
}) {
  return (
    <Card>
      <h2>Signed handovers and cash history</h2>
      <h3>Route handovers</h3>
      {!history.handovers.length ? (
        <p>No handovers signed.</p>
      ) : (
        history.handovers.map((h) => (
          <article key={h.id}>
            <p>
              {h.postingDate} ·{' '}
              {staff.find((s) => s.id === h.staffId)?.name ?? 'Recorded staff'}{' '}
              ·{' '}
              {routes.find((r) => r.id === h.routeId)?.name ?? 'Recorded route'}{' '}
              · Collection date {h.date}
            </p>
            <p>
              Expected {formatMoney(h.expected)} · Actual{' '}
              {formatMoney(h.actual)} · Memo {formatMoney(h.discrepancy)} ·
              Returned copies {h.returnedCopies}
            </p>
            <p>{h.signoff}</p>
          </article>
        ))
      )}
      <h3>Signed cash closes</h3>
      {!history.closes.length ? (
        <p>No cash closes signed.</p>
      ) : (
        history.closes.map((c) => (
          <article key={c.id}>
            <p>
              {c.date} · Opening {formatMoney(c.opening)} · Expected{' '}
              {formatMoney(c.expected)} · Counted {formatMoney(c.counted)} ·
              Deposit {formatMoney(c.bankDeposit)} · Variance{' '}
              {formatMoney(c.variance)}
            </p>
            <p>
              {c.reason} · {c.signoff}
            </p>
          </article>
        ))
      )}
      <h3>Cash movements and memo resolutions</h3>
      {!history.movements.length ? (
        <p>No outflows or suspense actions recorded.</p>
      ) : (
        history.movements.map((m) => (
          <p key={m.id}>
            {m.date} · {m.kind.replaceAll('_', ' ')} · {formatMoney(m.amount)} ·{' '}
            {m.reason}
          </p>
        ))
      )}
    </Card>
  );
}

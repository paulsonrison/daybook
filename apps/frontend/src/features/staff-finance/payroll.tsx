'use client';
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataState,
  Field,
  MetricCard,
  Notification,
  Select,
  formatMoney,
} from '@daybook/ui';
import { graphqlRequest } from '@/lib/graphql/client';
import { usePaymentsStore } from '../payments/hooks';
import { PendingRecovery } from '../payments/screen';
import { FinanceForm } from './forms';
import { PayrollRecords, PayslipDetails } from './records';
type Staff = { id: string; name: string };
type Preview = {
  fingerprint: string;
  salary: string;
  adjustment: string;
  commission: string;
  routeAllowance: string;
  advance: string;
  reimbursement: string;
  net: string;
  missingDays: number;
  missingPreparedDays: number;
};
type Slip = {
  id: string;
  code: string;
  month: string;
  net: string;
  paid: boolean;
  snapshot: string;
};
const modes = ['SALARY', 'PER_COPY', 'BLENDED'].map((value) => ({
  value,
  label:
    value === 'SALARY'
      ? 'Monthly salary'
      : value === 'PER_COPY'
        ? 'Per delivered copy'
        : 'Salary plus commission',
}));
const channels = ['CASH', 'UPI', 'BANK'].map((value) => ({
  value,
  label: value,
}));
export const PayrollScreen = observer(function PayrollScreen() {
  const store = usePaymentsStore(),
    [staff, setStaff] = useState<Staff[]>([]),
    [staffId, setStaffId] = useState(''),
    [month, setMonth] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null),
    [slips, setSlips] = useState<Slip[]>([]),
    [ack, setAck] = useState(false),
    [error, setError] = useState(''),
    [calculating, setCalculating] = useState(false);
  const locked =
    store.busy ||
    Boolean(store.pending) ||
    store.recoveryUnavailable ||
    store.state !== 'ready' ||
    calculating;
  useEffect(() => {
    let live = true;
    void graphqlRequest<{ staff: Staff[] }>('{staff{id name}}')
      .then((d) => {
        if (live) setStaff(d.staff);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setSlips([]);
    setAck(false);
    if (staffId && !store.busy)
      void graphqlRequest<{ payslips: Slip[] }>(
        'query($staff:ID!){payslips(staffId:$staff){id code month net paid snapshot}}',
        { staff: staffId },
      )
        .then((d) => {
          if (live) setSlips(d.payslips);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [staffId, store.busy]);
  async function calculate() {
    setCalculating(true);
    setPreview(null);
    setAck(false);
    setError('');
    try {
      const d = await graphqlRequest<{ payrollPreview: Preview }>(
        'query($staff:ID!,$month:String!){payrollPreview(staffId:$staff,month:$month){fingerprint salary adjustment commission routeAllowance advance reimbursement net missingDays missingPreparedDays}}',
        { staff: staffId, month },
      );
      setPreview(d.payrollPreview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCalculating(false);
    }
  }
  return (
    <div className="db-stack">
      <header>
        <h1>Staff pay & attendance</h1>
        <p>
          Review earnings and unpaid expense claims. Post a payslip before
          separately confirming its payout.
        </p>
      </header>
      <PendingRecovery store={store} />
      {(error || store.error) && (
        <Notification
          tone="error"
          title="Staff finance needs attention"
          description={error || store.error}
        />
      )}
      {store.notice && <Notification tone="success" title={store.notice} />}
      {store.state === 'loading' ? (
        <DataState kind="loading" title="Loading staff finance" />
      ) : (
        <>
          <Select
            label="Staff member"
            value={staffId}
            options={[
              { value: '', label: 'Choose staff' },
              ...staff.map((s) => ({ value: s.id, label: s.name })),
            ]}
            onChange={(e) => {
              setStaffId(e.target.value);
              setPreview(null);
            }}
            disabled={locked}
          />
          {!staffId ? (
            <DataState
              kind="empty"
              title="Choose a staff member"
              description="Add your team in Staff, then configure their employment and pay."
            />
          ) : (
            <>
              <PayrollRecords
                key={staffId}
                store={store}
                staffId={staffId}
                disabled={locked}
              />
              <div className="db-example-grid">
                <Card>
                  <h2>Effective pay rule</h2>
                  <FinanceForm
                    key={'rule' + staffId}
                    store={store}
                    operation="payRule"
                    label="Save pay rule"
                    disabled={locked}
                    base={{ staffId }}
                    fields={[
                      { key: 'startDate', label: 'Rule starts', type: 'date' },
                      {
                        key: 'endDate',
                        label: 'Rule ends',
                        type: 'date',
                        optional: true,
                      },
                      {
                        key: 'employmentStart',
                        label: 'Employment starts',
                        type: 'date',
                      },
                      {
                        key: 'employmentEnd',
                        label: 'Employment ends',
                        type: 'date',
                        optional: true,
                      },
                      {
                        key: 'mode',
                        label: 'Pay mode',
                        value: 'SALARY',
                        options: modes,
                      },
                      {
                        key: 'monthlySalary',
                        label: 'Monthly salary',
                        value: '0',
                      },
                      {
                        key: 'copyRate',
                        label: 'Commission per copy',
                        value: '0',
                      },
                      {
                        key: 'routeAllowance',
                        label: 'Allowance per worked route/day',
                        value: '0',
                      },
                      {
                        key: 'proration',
                        label: 'Salary proration',
                        value: 'CALENDAR_DAYS',
                        options: [
                          {
                            value: 'CALENDAR_DAYS',
                            label: 'Calendar days; unpaid absence excluded',
                          },
                          {
                            value: 'UNPRORATED',
                            label: 'Fixed month; no automatic proration',
                          },
                        ],
                      },
                    ]}
                  />
                </Card>
                <Card>
                  <h2>Attendance</h2>
                  <FinanceForm
                    key={'attendance' + staffId}
                    store={store}
                    operation="attendance"
                    label="Save attendance"
                    disabled={locked}
                    base={{ staffId }}
                    fields={[
                      {
                        key: 'date',
                        label: 'Attendance date',
                        type: 'date',
                        value: store.today,
                      },
                      {
                        key: 'status',
                        label: 'Attendance status',
                        value: 'PRESENT',
                        options: [
                          'PRESENT',
                          'PAID_LEAVE',
                          'UNPAID_LEAVE',
                          'ABSENT',
                        ].map((value) => ({
                          value,
                          label: value.replaceAll('_', ' '),
                        })),
                      },
                      { key: 'note', label: 'Attendance note' },
                    ]}
                  />
                </Card>
                <Card>
                  <h2>Confirmed salary advance</h2>
                  <FinanceForm
                    key={'advance' + staffId}
                    store={store}
                    operation="staffFunds"
                    label="Record advance"
                    disabled={locked}
                    base={{ staffId, kind: 'ADVANCE' }}
                    fields={[
                      {
                        key: 'date',
                        label: 'Advance date',
                        type: 'date',
                        value: store.today,
                      },
                      { key: 'amount', label: 'Advance amount' },
                      {
                        key: 'method',
                        label: 'Advance method',
                        value: 'CASH',
                        options: channels,
                      },
                      {
                        key: 'reference',
                        label: 'Advance reference',
                        optional: true,
                      },
                      {
                        key: 'confirmReceived',
                        label: 'I confirm the advance was actually disbursed',
                        type: 'checkbox',
                      },
                      {
                        key: 'evidence',
                        label: 'Advance confirmation evidence',
                      },
                    ]}
                  />
                </Card>
                <Card>
                  <h2>Unpaid expense reimbursement</h2>
                  <p>
                    Approving a claim does not record a cash payment. It is
                    added to the next payslip once.
                  </p>
                  <FinanceForm
                    key={'expense' + staffId}
                    store={store}
                    operation="staffFunds"
                    label="Approve unpaid expense"
                    disabled={locked}
                    base={{
                      staffId,
                      kind: 'REIMBURSEMENT',
                      method: 'UNPAID',
                      confirmReceived: false,
                    }}
                    fields={[
                      {
                        key: 'date',
                        label: 'Expense date',
                        type: 'date',
                        value: store.today,
                      },
                      { key: 'amount', label: 'Expense amount' },
                      {
                        key: 'approveExpense',
                        label: 'I approve this unpaid expense claim',
                        type: 'checkbox',
                      },
                      { key: 'evidence', label: 'Expense approval evidence' },
                    ]}
                  />
                </Card>
              </div>
              <Card>
                <h2>Monthly pay preview</h2>
                <Field
                  label="Payroll month"
                  type="month"
                  value={month}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    setPreview(null);
                  }}
                  disabled={locked || calculating}
                />
                <Button
                  disabled={locked || !month}
                  loading={calculating}
                  onClick={() => void calculate()}
                >
                  Calculate pay
                </Button>
                {preview && (
                  <div className="db-stack">
                    <div className="db-example-grid">
                      {(
                        [
                          'salary',
                          'adjustment',
                          'commission',
                          'routeAllowance',
                          'advance',
                          'reimbursement',
                        ] as const
                      ).map((k) => (
                        <MetricCard
                          key={k}
                          title={k.replace(/([A-Z])/g, ' $1')}
                          value={formatMoney(preview[k])}
                        />
                      ))}
                    </div>
                    <div data-testid="payroll-net">
                      <MetricCard
                        title="Net payable"
                        value={formatMoney(preview.net)}
                      />
                    </div>
                    <p>
                      {preview.missingDays} missing attendance days;{' '}
                      {preview.missingPreparedDays} unprepared delivery days.
                    </p>
                    <Checkbox
                      label="I reviewed missing attendance and preparation"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                      disabled={locked}
                    />
                    <Button
                      disabled={
                        locked ||
                        ((preview.missingDays > 0 ||
                          preview.missingPreparedDays > 0) &&
                          !ack)
                      }
                      onClick={() =>
                        void store.execute(
                          'payslip',
                          {
                            requestId: crypto.randomUUID(),
                            staffId,
                            month,
                            fingerprint: preview.fingerprint,
                            acknowledgeMissing: ack,
                          },
                          '',
                        )
                      }
                    >
                      Post payslip
                    </Button>
                  </div>
                )}
              </Card>
              <Card>
                <h2>Posted payslips</h2>
                {!slips.length ? (
                  <DataState kind="empty" title="No posted payslips" />
                ) : (
                  slips.map((s) => (
                    <article className="db-stack" key={s.id}>
                      <h3>
                        {s.code} · {s.month}
                      </h3>
                      <p>{formatMoney(s.net)}</p>
                      <Badge>
                        {s.paid
                          ? 'Payout confirmed'
                          : s.net === '0.00'
                            ? 'No payout due'
                            : 'Awaiting payout'}
                      </Badge>
                      <PayslipDetails snapshot={s.snapshot} />
                      {!s.paid && s.net !== '0.00' && (
                        <FinanceForm
                          store={store}
                          operation="payrollPayout"
                          label="Confirm payroll payout"
                          disabled={locked}
                          base={{ payslipId: s.id }}
                          fields={[
                            {
                              key: 'method',
                              label: 'Payout method',
                              value: 'CASH',
                              options: channels,
                            },
                            {
                              key: 'reference',
                              label: 'Payout reference',
                              optional: true,
                            },
                            {
                              key: 'confirmReceived',
                              label: 'I confirm the salary was actually paid',
                              type: 'checkbox',
                            },
                            {
                              key: 'evidence',
                              label: 'Payout confirmation evidence',
                            },
                          ]}
                        />
                      )}
                    </article>
                  ))
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
});

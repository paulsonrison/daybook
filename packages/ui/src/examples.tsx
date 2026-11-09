'use client';
import { useState, type ReactNode } from 'react';
import {
  AppShell,
  Avatar,
  Badge,
  BarChart,
  BillSummary,
  BrandMark,
  Button,
  Card,
  Checkbox,
  ColorSchemePicker,
  DataState,
  DataTable,
  DateRange,
  Dialog,
  DisplayModePicker,
  Drawer,
  Field,
  Icon,
  IconButton,
  MetricCard,
  NextRecord,
  Notification,
  Pagination,
  PaymentConfirmation,
  Radio,
  RecoveryPanel,
  SearchField,
  Select,
  Skeleton,
  StatusBadge,
  TableSkeleton,
  Tabs,
  Theme,
  Toggle,
  Tooltip,
  TypographyControls,
  badgeTones,
  defaultTypography,
  iconAssets,
  palette,
  recoveryPresets,
  type ColorScheme,
  type DataStateKind,
  type DisplayMode,
  type RecoveryId,
  type TypographyConfig,
} from './index';

export const sampleBill = {
  resident: {
    name: 'Anitha Nair',
    reference: 'R-0101',
    address: '12, Lotus Lane · Sector A · Kochi 682036',
  },
  invoice: 'DB-2026-1048',
  period: '01–31 October 2026',
  issued: '01 Nov',
  due: '07 Nov 2026',
  status: 'Saved' as const,
  lines: [
    {
      id: '1',
      publication: 'Malayala Manorama · Weekdays',
      quantity: 21,
      rate: 7,
      amount: 147,
    },
    {
      id: '2',
      publication: 'Malayala Manorama · Weekends',
      quantity: 8,
      rate: 8,
      amount: 64,
    },
    {
      id: '3',
      publication: 'The Hindu · Daily',
      quantity: 30,
      rate: 11,
      amount: 330,
    },
  ],
  totals: [
    { label: 'Current deliveries', amount: 541 },
    { label: 'Previous balance', amount: 240 },
    { label: 'Payments already received', amount: -100 },
    { label: 'Delivery credits / adjustments', amount: -20 },
    { label: 'TOTAL AMOUNT DUE', amount: 661 },
  ],
  note: '12 Oct vacation hold excluded from both daily papers. 25 Oct delivery removed; The Hindu rate updated to ₹11. No tax added.',
};
const residents = [
  {
    id: 'R-0101',
    name: 'Anitha Nair',
    papers: 'Manorama · The Hindu',
    due: '₹661',
    status: 'Active' as const,
  },
  {
    id: 'R-0102',
    name: 'Leela Menon',
    papers: 'Manorama · Weekly',
    due: '₹359',
    status: 'On hold' as const,
  },
];
export function ExampleSection({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="db-stack" style={{ scrollMarginTop: 24 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h2>
        {description && (
          <p className="db-field-hint" style={{ marginTop: 6 }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
export function ButtonVariants() {
  return (
    <div className="db-stack">
      {(['primary', 'secondary', 'tertiary', 'destructive'] as const).map(
        (variant) => (
          <ExampleSection
            key={variant}
            title={`Button/${variant[0].toUpperCase() + variant.slice(1)}`}
          >
            <div className="db-native-strip db-row">
              <Button variant={variant}>
                {variant === 'destructive'
                  ? 'Delete draft'
                  : variant === 'secondary'
                    ? 'View bill'
                    : variant === 'tertiary'
                      ? 'View details'
                      : 'Save bill'}
              </Button>
              <Button variant={variant} disabled>
                Save bill
              </Button>
              <Button variant={variant} loading loadingLabel="Saving…">
                Save bill
              </Button>
              <Button variant={variant} size="small">
                Save bill
              </Button>
              <Button variant={variant} size="medium">
                Save bill
              </Button>
              <Button variant={variant} size="large">
                Save bill
              </Button>
            </div>
          </ExampleSection>
        ),
      )}
    </div>
  );
}
export function ControlsExample() {
  const [name, setName] = useState('Anitha Nair');
  const [route, setRoute] = useState('R01');
  const [query, setQuery] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState('monthly');
  const [range, setRange] = useState({ from: '2026-10-01', to: '2026-10-31' });
  const results = residents
    .filter((row) =>
      `${row.name} ${row.id}`.toLowerCase().includes(query.toLowerCase()),
    )
    .map((row) => ({ value: row.id, label: `${row.name} · ${row.id}` }));
  return (
    <div className="db-stack">
      <ExampleSection title="Field, select and search">
        <div className="db-example-grid">
          <Field
            label="Resident name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Field
            label="Invalid quantity"
            type="number"
            defaultValue={-1}
            error="Enter a whole number from 0 to 30."
          />
          <Field
            label="Read only"
            value="Anitha Nair"
            disabled
            hint="Read only · permission required to edit"
          />
          <Field
            label="Loading saved value"
            value="Anitha Nair"
            readOnly
            loading
          />
          <Select
            label="Route"
            value={route}
            onChange={(event) => setRoute(event.target.value)}
            options={[
              { value: 'R01', label: 'R01 · Panampilly Nagar' },
              { value: 'R02', label: 'R02 · Kadavanthra' },
            ]}
          />
          <Select label="Unavailable routes" options={[]} state="empty" />
        </div>
        <SearchField
          label="Find a resident"
          placeholder="Name or address"
          value={query}
          onValueChange={setQuery}
          results={query ? results : undefined}
          state={query && results.length === 0 ? 'no-results' : 'ready'}
          onSelect={(option) => setQuery(option.label)}
        />
      </ExampleSection>
      <ExampleSection title="Checkbox, radio and toggle">
        <div className="db-row">
          <Checkbox
            label="Select residents"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <Checkbox label="Mixed selection" indeterminate />
          <Checkbox label="Read only selection" checked disabled />
          <Radio
            label="Monthly billing"
            name="billing"
            value="monthly"
            checked={radio === 'monthly'}
            onChange={() => setRadio('monthly')}
          />
          <Radio
            label="Weekly billing"
            name="billing"
            value="weekly"
            checked={radio === 'weekly'}
            onChange={() => setRadio('weekly')}
          />
          <Toggle
            label="Collection reminders"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </div>
      </ExampleSection>
      <ExampleSection title="Date & period controls">
        <DateRange
          {...range}
          onChange={setRange}
          latestAllowedDate="2026-11-09"
        />
      </ExampleSection>
    </div>
  );
}
export function RecordsExample() {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<
    | 'ready'
    | 'loading'
    | 'empty'
    | 'no-results'
    | 'error'
    | 'partial'
    | 'offline'
  >('ready');
  return (
    <div className="db-stack">
      <Select
        label="Table state"
        value={state}
        onChange={(event) => setState(event.target.value as typeof state)}
        options={[
          'ready',
          'loading',
          'empty',
          'no-results',
          'error',
          'partial',
          'offline',
        ].map((value) => ({ value, label: value }))}
      />
      <DataTable
        caption="Route collection"
        rows={residents}
        rowKey={(row) => row.id}
        state={state}
        onRetry={() => setState('ready')}
        emptyAction={
          <Button onClick={() => setState('ready')}>Clear filters</Button>
        }
        columns={[
          {
            key: 'resident',
            header: 'Resident',
            render: (row) => (
              <div className="db-row">
                <Avatar name={row.name} />
                <div>
                  <strong>{row.name}</strong>
                  <p className="db-field-hint">{row.id}</p>
                </div>
              </div>
            ),
          },
          { key: 'papers', header: 'Newspapers', render: (row) => row.papers },
          {
            key: 'status',
            header: 'Status',
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: 'due',
            header: 'Due',
            align: 'right',
            render: (row) => row.due,
          },
        ]}
      />
      <Pagination
        total={326}
        page={page}
        pageSize={5}
        onPageChange={setPage}
        label="residents"
      />
      <div className="db-example-grid">
        <MetricCard
          title="Collected this month"
          value="₹2,21,400"
          description="Confirmed collections"
        />
        <BarChart
          title="Weekly collections"
          data={[
            { label: 'Week 1', value: 42 },
            { label: 'Week 2', value: 72 },
            { label: 'Week 3', value: 94 },
            { label: 'Week 4', value: 60 },
          ]}
        />
      </div>
    </div>
  );
}
export function OverlaysExample() {
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState(false);
  const body = (
    <div className="db-stack">
      <p>Anitha Nair · October 2026 · ₹661.00 due</p>
      <Field
        label="Quantity"
        defaultValue={30}
        type="number"
        min={0}
        max={30}
      />
      {error && (
        <Notification
          tone="error"
          title="Couldn’t save. Your draft is preserved."
          description="Demonstration failure · no request was sent."
        />
      )}
    </div>
  );
  return (
    <div className="db-row">
      <Tooltip content="Print this saved invoice with all delivery dates, applied rates and payment details.">
        <IconButton
          label="Print saved bill"
          icon="print"
          onClick={() => setDialog(true)}
        />
      </Tooltip>
      <Button variant="secondary" onClick={() => setDialog(true)}>
        Open dialog
      </Button>
      <Button variant="secondary" onClick={() => setDrawer(true)}>
        Open drawer
      </Button>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Review bill changes"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => setError(true)}>Save bill</Button>
          </>
        }
      >
        {body}
      </Dialog>
      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Review bill changes"
        footer={
          <Button variant="secondary" onClick={() => setDrawer(false)}>
            Close drawer
          </Button>
        }
      >
        {body}
      </Drawer>
    </div>
  );
}
export function RecoveryExample() {
  const [scenario, setScenario] = useState<RecoveryId>('16');
  const [action, setAction] = useState('');
  return (
    <div className="db-stack">
      <Select
        label="Recovery scenario"
        value={scenario}
        onChange={(event) => {
          setScenario(event.target.value as RecoveryId);
          setAction('');
        }}
        options={recoveryPresets.map((item) => ({
          value: item.id,
          label: `${item.id} / ${item.name}`,
        }))}
      />
      <RecoveryPanel scenario={scenario} onAction={setAction} />
      {action && (
        <Notification
          title={`Selected: ${action}`}
          description="Demonstration callback · no server request was sent."
        />
      )}
      <Card title="Behavior & recovery">
        <p>{recoveryPresets.find((item) => item.id === scenario)?.behavior}</p>
      </Card>
    </div>
  );
}
export function FeedbackExamples() {
  const [hidden, setHidden] = useState<string[]>([]);
  const [kind, setKind] = useState<DataStateKind>('empty');
  return (
    <div className="db-stack">
      <ExampleSection title="Badge">
        <div className="db-row">
          {Object.keys(badgeTones).map((status) => (
            <StatusBadge
              key={status}
              status={status as keyof typeof badgeTones}
            />
          ))}
        </div>
      </ExampleSection>
      <ExampleSection title="Notification">
        <div className="db-stack">
          {(['success', 'info', 'warning', 'error'] as const)
            .filter((tone) => !hidden.includes(tone))
            .map((tone) => (
              <Notification
                key={tone}
                tone={tone}
                title={
                  {
                    success: 'Bill saved successfully',
                    info: 'Your route stays in context',
                    warning: 'Review before recording payment',
                    error: 'Payment could not be saved',
                  }[tone]
                }
                description={
                  {
                    success:
                      'DB-2026-1048 is ready to print or share. ₹661.00 remains due.',
                    info: 'Move to next keeps R01, October 2026 and delivery order selected.',
                    warning:
                      'Confirm the amount and payment method before marking this bill as paid.',
                    error:
                      'No payment was recorded. Check the connection and try again.',
                  }[tone]
                }
                onDismiss={() => setHidden([...hidden, tone])}
              />
            ))}
        </div>
        {hidden.length > 0 && (
          <Button variant="tertiary" onClick={() => setHidden([])}>
            Restore notifications
          </Button>
        )}
      </ExampleSection>
      <ExampleSection title="Loading, skeleton, empty and recovery">
        <Select
          label="Content state"
          value={kind}
          onChange={(event) => setKind(event.target.value as DataStateKind)}
          options={[
            'loading',
            'empty',
            'no-results',
            'error',
            'offline',
            'partial',
            'slow',
            'missing',
            'access-denied',
            'session-expired',
          ].map((value) => ({ value, label: value }))}
        />
        <DataState
          kind={kind}
          onRetry={
            ['error', 'slow'].includes(kind)
              ? () => setKind('loading')
              : undefined
          }
        />
        <TableSkeleton rows={2} />
      </ExampleSection>
      <ExampleSection title="24 workflow exceptions">
        <RecoveryExample />
      </ExampleSection>
    </div>
  );
}
export function BillingExamples() {
  const [status, setStatus] = useState<
    'confirmed' | 'checking' | 'unknown' | 'partial' | 'duplicate'
  >('confirmed');
  const [message, setMessage] = useState('');
  return (
    <div className="db-stack">
      <BillSummary {...sampleBill} />
      <Select
        label="Payment state"
        value={status}
        onChange={(event) => setStatus(event.target.value as typeof status)}
        options={[
          'confirmed',
          'checking',
          'unknown',
          'partial',
          'duplicate',
        ].map((value) => ({ value, label: value }))}
      />
      <PaymentConfirmation
        status={status}
        amount={status === 'partial' ? 200 : 661}
        remaining={status === 'partial' ? 461 : 0}
        invoice="DB-2026-1048"
        description={
          status === 'partial'
            ? '₹200.00 received · ₹461.00 remaining.'
            : status === 'confirmed'
              ? 'Anitha Nair’s October bill is paid. Your collection position stays on R01.'
              : undefined
        }
        method="Cash · 01 Nov 2026"
        recordedAt="09:48 AM"
        onReceipt={() => setMessage('Receipt selected')}
        onNext={() => setMessage('Next resident selected')}
        onCheckStatus={() => setMessage('Status check selected')}
      />
      <NextRecord
        name="Leela Menon"
        description="Drop 002 · 14, Lotus Lane · ₹359 due"
        context="R01 · Panampilly Nagar · Resident 002 of 326"
        onNext={() => setMessage('Next resident selected')}
      />
      {message && (
        <Notification
          title={message}
          description="Demonstration callback · no payment or navigation was performed."
        />
      )}
    </div>
  );
}
export function IconExamples() {
  return (
    <div className="db-row">
      {Object.keys(iconAssets)
        .filter((name) => !name.startsWith('brand'))
        .map((name) => (
          <div
            key={name}
            className="db-stack"
            style={{ alignItems: 'center', gap: 6, minWidth: 64 }}
          >
            <Icon
              name={name as keyof typeof iconAssets}
              size={name === 'loader' ? 12 : 32}
            />
            <small>{name}</small>
          </div>
        ))}
      <BrandMark />
      <Icon fallback="Print (fallback)" />
    </div>
  );
}
export function ComponentCatalogue() {
  const [mode, setMode] = useState<DisplayMode>('light');
  const [scheme, setScheme] = useState<ColorScheme>('teal');
  const [typography, setTypography] =
    useState<TypographyConfig>(defaultTypography);
  const [tab, setTab] = useState('components');
  return (
    <Theme mode={mode} scheme={scheme} typography={typography}>
      <AppShell
        navigation={[
          {
            label: 'Workspace',
            items: [
              { label: 'Project home', href: '/', icon: 'bill' },
              {
                label: 'Reusable components',
                href: '/ui',
                icon: 'settings',
                active: true,
              },
            ],
          },
        ]}
        header={
          <>
            <span>Daybook / Design library</span>
            <Badge tone="success">Figma references extracted</Badge>
          </>
        }
        footer={
          <div className="db-row">
            <Avatar name="Ravi Kumar" />
            <div>
              <strong>Daybreak Agency</strong>
              <p className="db-field-hint">Demo workspace · Sample data</p>
            </div>
          </div>
        }
      >
        <div className="db-stack" style={{ gap: 32 }}>
          <header className="db-stack">
            <p className="db-eyebrow">Daybook / Native components</p>
            <h1 style={{ fontSize: 30, fontWeight: 600 }}>
              A reusable agency workspace.
            </h1>
            <p className="db-muted">
              Local components, themes, typography and recovery states from the
              three Figma pages.
            </p>
          </header>
          <Tabs
            label="Design library sections"
            value={tab}
            onValueChange={setTab}
            items={[
              {
                id: 'components',
                label: 'Components',
                content: (
                  <div className="db-stack" style={{ gap: 32 }}>
                    <ButtonVariants />
                    <ExampleSection title="Icons & symbols">
                      <IconExamples />
                    </ExampleSection>
                    <ControlsExample />
                    <ExampleSection title="Card, table & pagination">
                      <RecordsExample />
                    </ExampleSection>
                    <ExampleSection title="Dialog, drawer & tooltip">
                      <OverlaysExample />
                    </ExampleSection>
                  </div>
                ),
              },
              {
                id: 'states',
                label: 'Loading & recovery',
                content: <FeedbackExamples />,
              },
              {
                id: 'themes',
                label: 'Theme & typography',
                content: (
                  <div className="db-stack" style={{ gap: 32 }}>
                    <ExampleSection title="Display mode">
                      <DisplayModePicker value={mode} onChange={setMode} />
                    </ExampleSection>
                    <ExampleSection
                      title="Color scheme"
                      description="15 exact preview palettes; full Teal light and Nord dark references."
                    >
                      <ColorSchemePicker value={scheme} onChange={setScheme} />
                    </ExampleSection>
                    <ExampleSection title="Typography customization">
                      <TypographyControls
                        value={typography}
                        onChange={setTypography}
                      />
                      <Card title="A clearer daily rhythm.">
                        <p>
                          Every resident. Every paper. Every collection, in
                          order.
                        </p>
                        <p>Aa Bb Cc · 0123456789 · ₹661.00</p>
                      </Card>
                    </ExampleSection>
                    <ExampleSection title="Color tokens">
                      <div className="db-preference-grid">
                        {Object.entries(palette).map(([name, color]) => (
                          <div className="db-card" key={name}>
                            <Skeleton
                              height={32}
                              style={{ background: color, animation: 'none' }}
                            />
                            <strong>{name}</strong>
                            <p className="db-field-hint">{color}</p>
                          </div>
                        ))}
                      </div>
                    </ExampleSection>
                  </div>
                ),
              },
              {
                id: 'billing',
                label: 'Billing & collection',
                content: <BillingExamples />,
              },
            ]}
          />
        </div>
      </AppShell>
    </Theme>
  );
}

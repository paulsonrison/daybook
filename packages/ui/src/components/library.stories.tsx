import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  AssetImage,
  Button,
  Card,
  DataState,
  ExportControl,
  Icon,
  MetricCard,
  Notification,
  PaymentConfirmation,
  RecordCard,
  RecoveryPanel,
  Skeleton,
  StatusBadge,
  TableSkeleton,
  Theme,
  Tooltip,
  TypographySpecimen,
  WorkflowButton,
  WorkspaceState,
  iconAssets,
  recoveryPresets,
  workflowActions,
} from '../index';
import {
  BillingExamples,
  ButtonVariants,
  ComponentCatalogue,
  ControlsExample,
  FeedbackExamples,
  IconExamples,
  OverlaysExample,
  RecordsExample,
  RecoveryExample,
} from '../examples';
const meta = {
  title: 'Library/Component coverage',
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Buttons: Story = { render: () => <ButtonVariants /> };
export const InputsAndSelections: Story = { render: () => <ControlsExample /> };
export const IconsAndFallback: Story = { render: () => <IconExamples /> };
export const TableAndPagination: Story = { render: () => <RecordsExample /> };
export const DialogDrawerAndTooltip: Story = {
  render: () => <OverlaysExample />,
};
export const LoadingAndFeedback: Story = { render: () => <FeedbackExamples /> };
export const BillingAndCollection: Story = {
  render: () => <BillingExamples />,
};
export const WorkflowRecovery: Story = { render: () => <RecoveryExample /> };
export const AllRecoveryScenarios: Story = {
  render: () => (
    <div className="db-stack">
      {recoveryPresets.map((preset) => (
        <Card key={preset.id} title={`${preset.id} / ${preset.name}`}>
          <RecoveryPanel
            scenario={
              preset.id as Parameters<typeof RecoveryPanel>[0]['scenario']
            }
            onAction={() => {}}
          />
        </Card>
      ))}
    </div>
  ),
};
export const MissingAndUnknownData: Story = {
  render: () => (
    <div className="db-stack">
      <DataState kind="missing" />
      <Icon fallback="Print (fallback)" />
      <MetricCard title="Confirmed total" value={null} />
      <PaymentConfirmation
        status="unknown"
        amount={null}
        invoice="DB-2026-1048"
        onCheckStatus={() => {}}
      />
    </div>
  ),
};
export const Skeletons: Story = {
  render: () => (
    <div className="db-stack">
      <Skeleton width={34} height={34} circle />
      <Skeleton width="60%" height={20} />
      <TableSkeleton />
    </div>
  ),
};
export const MissingImage: Story = {
  render: () => <AssetImage alt="Publication cover" width={240} height={160} />,
};
export const RecordCards: Story = {
  render: () => (
    <div className="db-stack">
      <RecordCard
        title="Anitha Nair"
        avatar="Anitha Nair"
        status={<StatusBadge status="Active" />}
      />
      <RecordCard
        title="R01 · Panampilly Nagar"
        status={<StatusBadge status="Active" />}
      />
      <RecordCard title="Anitha Nair" state="partial" />
      <RecordCard title="Anitha Nair" state="error" onRetry={() => {}} />
    </div>
  ),
};
export const WorkflowButtons: Story = {
  render: () => (
    <div className="db-row">
      {Object.keys(workflowActions).map((action) => (
        <WorkflowButton
          key={action}
          action={action as keyof typeof workflowActions}
        />
      ))}
    </div>
  ),
};
export const Typography: Story = { render: () => <TypographySpecimen /> };
export const ExportStates: Story = {
  render: () => (
    <div className="db-stack">
      {(
        [
          'ready',
          'preparing',
          'download-ready',
          'error',
          'share-unavailable',
          'permission-denied',
        ] as const
      ).map((state) => (
        <ExportControl
          key={state}
          state={state}
          invoice="DB-2026-1048"
          onDownload={() => {}}
          onRetry={() => {}}
          onReturn={() => {}}
        />
      ))}
    </div>
  ),
};
export const WorkspaceStates: Story = {
  render: () => (
    <div className="db-stack">
      {(
        [
          'boot',
          'offline',
          'expired',
          'denied',
          'missing',
          'unavailable',
        ] as const
      ).map((state) => (
        <WorkspaceState
          key={state}
          state={state}
          onReturn={() => {}}
          onSignIn={() => {}}
          onRetry={() => {}}
        />
      ))}
    </div>
  ),
};
export const LongContent: Story = {
  render: () => (
    <Card title="Anitha Nair · Sunrise Apartments · Sector A · Panampilly Nagar · Kochi">
      <div className="db-stack">
        <StatusBadge status="Pending sync" />
        <Notification
          tone="warning"
          title="Some delivery updates could not be synced"
          description="Your route and entered values are preserved. Review each result before continuing. This message wraps inside its own layout region without overlapping the actions."
        />
        <Tooltip content="Print this saved invoice with all delivery dates, applied rates and payment details.">
          <Button variant="secondary">
            Print saved invoice with delivery details
          </Button>
        </Tooltip>
      </div>
    </Card>
  ),
};
export const DarkTheme: Story = {
  render: () => (
    <Theme
      mode="dark"
      scheme="nord"
      typography={{ size: 18 }}
      style={{ padding: 24 }}
    >
      <ControlsExample />
      <RecordsExample />
    </Theme>
  ),
};
export const Catalogue: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <ComponentCatalogue />,
};
export const AssetInventory: Story = {
  render: () => (
    <div className="db-row">
      {Object.entries(iconAssets).map(([name, url]) => (
        <figure key={name}>
          <img
            src={url}
            alt={name}
            width={name === 'loader' ? 12 : name === 'brand' ? 33 : 32}
            height={name === 'loader' ? 12 : name === 'brand' ? 36 : 32}
          />
          <figcaption>{name}</figcaption>
        </figure>
      ))}
    </div>
  ),
};

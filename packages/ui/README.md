# @daybook/ui

Reusable React 19 presentation components extracted from the Daybook Figma file. This source package works with Next.js (`transpilePackages: ['@daybook/ui']`) and Vite/Storybook. It contains no routing dependency, API client, domain store, payment processing or preference persistence.

## Use

Import `@daybook/ui/styles.css` once. Import `@daybook/ui/fonts.css` to serve the bundled Inter, Manrope, Nunito Sans and Lora WOFF2 files locally. Font loading makes no third-party HTTP requests. Applications may instead supply their own font faces and override the CSS variables.

```tsx
import '@daybook/ui/fonts.css';
import '@daybook/ui/styles.css';
import { Button, Card, Theme } from '@daybook/ui';

export function Workspace() {
  return (
    <Theme mode="light" scheme="teal">
      <Card title="Route collection">
        <Button
          onClick={() => {
            /* call the application's save handler */
          }}
        >
          Save bill
        </Button>
      </Card>
    </Theme>
  );
}
```

Use a client component when passing event handlers in Next.js. Interactive and localized library components declare their own client boundaries. Server components can render `BillSummary` with serializable bill data; its table render functions stay inside the library's client composition. Callbacks belong in a client component. `/ui/server-presentation` exercises this contract in the application.

## Public entry points

| Import                   | Contents                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `@daybook/ui`            | Components, types, utilities, tokens and theme configuration                              |
| `@daybook/ui/tokens`     | Palette, spacing, radii, control sizes, 15 schemes, fonts and reading presets             |
| `@daybook/ui/assets`     | Local vector URLs and `IconName`; URLs are resolved by the consuming bundler              |
| `@daybook/ui/styles.css` | Scoped component styles and theme variables                                               |
| `@daybook/ui/fonts.css`  | Optional self-hosted fonts, including available italic faces                              |
| `@daybook/ui/examples`   | Interactive catalogue and sample-data demonstrations; keep out of production entry points |

## Components

| Family      | Exports / behavior                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions     | `Button`, `IconButton`, `WorkflowButton`, `workflowActions`; primary, secondary, tertiary, destructive; small/medium/large; pending and disabled states        |
| Inputs      | `Field`, `Select`, `SearchField`; labels, hints, required, invalid, pending, empty options, failed options, preserved selection and retry                      |
| Selection   | `Checkbox`, `Radio`, `Toggle`; native keyboard behavior, indeterminate selection, disabled and pending save feedback                                           |
| Containers  | `Card`, `RecordCard`, `Avatar`; loading, empty, partial, failed and long-content record presentations                                                          |
| Status      | `Badge`, `StatusBadge`, `Notification`; semantic status text, distinct tones, independent dismissal and stacked layout                                         |
| Loading     | `LoadingIndicator`, `Skeleton`, `TableSkeleton`; reserved geometry and reduced-motion support                                                                  |
| Recovery    | `DataState`, `RecoveryPanel`, `recoveryPresets`, `WorkspaceState`, `ExportControl`; missing, empty, offline, partial, slow, denied, expired and failure states |
| Data        | `DataTable`, `Pagination`, `MetricCard`, `BarChart`; semantic tables, optional controlled sorting, clamped page boundaries and explicit missing values         |
| Navigation  | `Tabs`, `AppShell`; keyboard tab movement, disabled tabs, skip link and configurable navigation/header/footer                                                  |
| Overlays    | `Dialog`, `Drawer`, `Tooltip`; native modal focus containment, Escape dismissal, reserved header/footer, scrolling body and tooltip viewport bounds            |
| Dates       | `DateRange`; empty, invalid, reversed and future-period validation; caller supplies the latest allowed date                                                    |
| Billing     | `BillSummary`, `PaymentConfirmation`, `NextRecord`; server-supplied amounts/status, loading, unknown, partial, duplicate, removed and end-of-run presentations |
| Preferences | `Theme`, `ColorSchemePicker`, `DisplayModePicker`, `TypographyControls`, `TypographySpecimen`; scoped preferences and real font fallback                       |
| Assets      | `Icon`, `BrandMark`, `AssetImage`; 39 original local SVGs, light/dark brand variants, missing-icon text and reserved loading/missing image slots               |

## State ownership

Controls are controlled where data is shared: pass `value`, `onChange`, `checked` and callbacks from the application. `saveState="error"` reports a failure; the application must supply its restored confirmed selection. The library cannot determine whether a mutation committed.

`PaymentConfirmation status="unknown"` provides only a status-check action. It never renders a receipt or a second payment submission. Render `confirmed` only after server acknowledgement. `BillSummary` receives totals rather than calculating charges. Unknown numeric data displays as unavailable, never as a confirmed zero. Partial charts and tables preserve available content and label incomplete totals.

`RecoveryPanel` exposes all 24 original scenarios. Override `title`, `description` and `actionLabels` for real records, and handle `onAction` in the application. The reference copy includes sample names, dates and amounts. Progress scenarios do not expose an enabled submission. Add context-specific controls through `children`.

Typography supports 12–24 px, four font families, four weights, normal/italic and 1.25/1.45/1.6 line spacing. Invalid sizes receive validation and a safe preview size. Manrope does not supply an italic face; an actual Inter italic face is used while retaining the selected Manrope preference.

Only Teal light and Nord dark have complete screen references. The other 14 schemes have exact light preview palettes and share semantic roles. Status colors retain their meaning across schemes. `mode="system"` follows the browser media query. The library deliberately leaves persistence and cross-device synchronization to its consumer. Printed bills use a light presentation.

No raster images appear in the supplied 187 frames. `AssetImage` is an opt-in extension for future media; it is not represented as a Figma-extracted image component.

## Review and reuse

- App catalogue: `npm run dev`, then `/ui`.
- Storybook: `npm run storybook`.
- Package checks: `npm run typecheck -w @daybook/ui`, `npm run lint -w @daybook/ui`, `npm run test -w @daybook/ui`.
- Re-extract original vectors and recovery text: `powershell -File scripts/extract-figma-assets.ps1` from the repository root.
- Local Figma reference viewer: `node scripts/design-review.mjs`, then `http://127.0.0.1:4174`.
- Another workspace: copy this package into `packages/ui`, include it in npm workspaces and install its declared dependencies. Keep the CSS, SVGs and font packages with the source. It can also be packed with `npm pack -w @daybook/ui`; a consuming project must transpile its TypeScript source. Publishing is not enabled.

Reference exports, provenance and verification are in `docs/design/`. They are review artifacts and are never used as screenshots in place of interactive application components.

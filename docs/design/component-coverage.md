# Figma extraction coverage

Source: file `86N455oNGTMupW2wYsIXkb`, pages `0:1`, `37:418` and `40:418`. The signed-in Chrome tab was used at the user's instruction after the Figma connector hit its plan limit. The checked-in SVGs retain text, fonts, geometry, paths and layer names. The inventory indexes **187 frames**, including **33 component coverage sheets**.

## Mapping

| Figma family                                     | Shared implementation                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Button/Primary, Secondary, Tertiary, Destructive | `Button` variants, sizes, focus/hover, disabled and pending                                         |
| IconButton                                       | `IconButton`, named action and missing-icon text                                                    |
| Tooltip                                          | `Tooltip`, keyboard focus, Escape, long text and viewport clamping                                  |
| Icon                                             | `Icon`, original SVG assets, decorative/named modes and fallback                                    |
| Badge                                            | `Badge`, `StatusBadge`, textual status independent of color                                         |
| Field                                            | `Field`, required/invalid, disabled/loading, linked error/hint and long value                       |
| Select                                           | `Select`, loading/empty/no matches/error/disabled/long option; current value preserved              |
| Search                                           | `SearchField`, loading/no results/error/long query/clear and native result buttons                  |
| Checkbox, Radio, Toggle                          | Native controls, mixed state, pending and save-error presentation                                   |
| Card                                             | `Card`, `RecordCard`, skeleton/empty/partial/error/long content                                     |
| Bill/Summary                                     | `BillSummary`; `Field`, `DataState` and `Notification` for editable/error compositions              |
| Confirmation/Paid                                | `PaymentConfirmation`: confirmed/checking/unknown/partial/duplicate                                 |
| Collection/NextResident                          | `NextRecord`: ready/loading/end/skipped/removed                                                     |
| Button/Workflow                                  | Seven `WorkflowButton` actions and callback-driven pending states                                   |
| Notification                                     | Four semantic tones, independent dismissal and normal-flow stacking                                 |
| Typography/Family, Size, Style, LineSpacing      | `TypographyControls`, typed configuration, bundled fonts, validation and fallback                   |
| Typography/Specimen                              | `TypographySpecimen`, missing/loading preview and long reading content                              |
| Table                                            | `DataTable`, semantic headers, skeleton/empty/no matches/error/partial/offline                      |
| Pagination                                       | `Pagination`, first/middle/last, empty/loading/removed-page boundaries                              |
| Tabs & navigation                                | `Tabs`, `AppShell`; keyboard navigation, disabled, loading/error panels and long labels             |
| Date & period controls                           | `DateRange`, valid/empty/reversed/future/loading/unavailable                                        |
| Charts & metrics                                 | `MetricCard`, `BarChart`, skeleton/empty/partial/error/confirmed zero                               |
| Dialog & drawer                                  | `Dialog`, `Drawer`, native modal containment; caller slots for validation/failed save/unsaved edits |
| Export & sharing                                 | `ExportControl`: ready/preparing/download ready/error/share unavailable/permission denied           |
| App shell & session                              | `AppShell`, `WorkspaceState`: boot/offline/expired/denied/not found/unavailable                     |

All 24 workflow exception messages and action labels are exported in `recovery-presets.json`. Progress messages preserve their behavior notes. `RecoveryPanel` composes these with shared feedback and skeletons. Screens remain consumer-owned; this extraction does not implement agency CRUD, payments, synchronization or authentication.

## Fidelity boundaries

- Exact variables, native control colors, type metadata, brand graphics and original vector paths are retained. Tests compare every exported vector path to an original source and verify local definitions.
- Native primary buttons were checked in Chrome for teal `#087F73`, 13 px semibold Inter, 6 px radii and 32/40/48 px heights. Flexible text widths use browser font metrics rather than Figma's rounded text-frame widths.
- The native payment confirmation preserves its vertical badge/amount sequence, 52 px success mark, 23 px heading, full-width receipt details and left-aligned actions. Bill headers use the native 22 px title.
- The responsive catalogue is a review surface, not a replica of the Figma canvas arrangement or a claim that all 187 complete screens have been implemented.
- Native HTML select menus, date pickers and modal focus behavior follow the browser/platform. Their control surfaces use extracted styling.
- Teal light and Nord dark are fully specified. Other scheme accents and backgrounds come from exact Figma preview cards; additional dark variants are shared derived behavior.
- No raster image nodes exist in the references. The optional `AssetImage` missing/loading slot is an explicit extension, not extracted artwork.
- Figma Code Connect could not be read because of the connector quota. Browser extraction was the user-authorized replacement. No Figma design content was edited; temporary export settings were removed after downloading.

The package exposes the required states for composition. Consumers must supply confirmed data, preserve drafts, restore failed optimistic selections and wire action callbacks. The examples identify their callbacks as demonstrations and never record real payments.

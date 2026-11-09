# Shared UI verification — 9 November 2026

## Automated evidence

| Check                                        | Result                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                          | PASS: backend, frontend and UI package                                                                      |
| `npm run lint`                               | PASS: frontend and UI TypeScript/React Hooks rules                                                          |
| `npm test`                                   | PASS: 5 existing backend tests and 13 new UI tests                                                          |
| `npm run build`                              | PASS: backend build and Next.js production build, including `/ui`                                           |
| `npm run build-storybook`                    | PASS: component, state, billing, typography and asset stories                                               |
| `npm run format:check -- --end-of-line auto` | PASS: complete repository with Windows checkout line endings                                                |
| Changed-file Prettier check                  | PASS without the line-ending override                                                                       |
| `git diff --check`                           | PASS                                                                                                        |
| `npm pack -w @daybook/ui --dry-run --json`   | PASS: 70 files, 207,175 unpacked bytes, 39 icon assets, fonts entry included, no caches/builds/node_modules |

The unmodified default formatting command flags CRLF line endings in 33 untouched checkout files. The original Git version of the Prettier configuration passes when checked independently. No unrelated files were reformatted. Storybook reports large documentation/runtime chunks and an inability to save global preferences outside the workspace; neither blocks its successful build.

The UI tests cover removed/invalid pages, missing versus confirmed-zero amounts, impossible/leap/reversed/future dates, duplicate-submit prevention while pending, input/error relationships, temporarily unavailable selected options, unknown payment outcomes, partial receipts, missing chart data, partial tables, all 24 recovery messages, invalid typography and all 39 local vector assets. Every vector path is checked against an original export, and referenced local definitions must exist.

## Chrome evidence

The already-open Chrome window and existing preview tab were used. The Figma source tab remains available. No new sign-in was performed.

- Inspected the signed-in Figma variable table and downloaded the 187 reference frames from all three supplied pages. Temporary export settings were removed.
- Inspected native SVG references and the rendered `/ui` catalogue. Verified 13 px Inter button text, semibold weight, teal fill, 6 px radius, and 32/40/48 px button heights.
- Entered a draft resident name, switched tabs and verified it remained intact.
- Entered an unmatched search and verified the no-results message; cleared the search using its control.
- Exercised the uncertain-payment recovery callback and confirmed its feedback.
- Opened and dismissed both a dialog and drawer, including Escape. Checked keyboard focus movement inside the dialog.
- Selected Nord dark, Lora italic and 18 px reading size. Inspected the actual dark background `rgb(24, 44, 48)`, foreground `rgb(237, 244, 248)` and primary `#90c5de`.
- Entered reading size 0 and verified the 12–24 px validation message.
- Selected an unknown payment outcome and verified zero receipt buttons and an available status-check action.
- Browser warning/error log was empty after the interaction checks.
- Checked the existing Chrome window at 175% zoom and approximately 590 CSS px available width. Navigation stacked and button groups wrapped without overlap. This checks the compact breakpoints; it is not a physical-device test.
- Restored normal zoom and maximized the same window, leaving `/ui` open.

Review images: `ui-catalogue-desktop.jpg` and `ui-catalogue-compact.jpg`.

## Fidelity and limits

The shared component families, exact original vectors, tokens, font configuration and available state presentations are implemented. The 187 exports are references, not 187 completed application screens. Native browser menus/date pickers vary by platform. Browser font metrics can differ slightly from Figma's rounded text frames. Only Teal light and Nord dark have full-screen theme specifications; other preview palettes are exact, while their dark treatment shares the extracted dark roles. No exhaustive screenshot pixel-difference assertion or physical-device test is claimed.

Application workflows, real payments, authentication, optimistic-state restoration and preference persistence remain consumer responsibilities. No database schema or backend application behavior was changed. No real payment, export, save or message was submitted by the catalogue demonstrations.

## Skill-governor audit

| Assigned skill       | Result                                  | Concrete evidence                                                                                                                                           |
| -------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skill-governor       | PASS                                    | Selection and approval recorded; user-authorized Chrome replacement preserved; scope and evidence documented here                                           |
| plan-first           | PASS                                    | Existing package, frontend and architecture inspected before edits; six-step plan in `ui-extraction-plan.md`; checks run during implementation              |
| figma-design-to-code | PASS with authorized browser adaptation | Connector quota failure disclosed; user requested Chrome; 187 exact exports, local original vectors, native metadata and browser geometry/style checks used |
| karpathy-guidelines  | PASS                                    | Extended existing UI workspace; API/state ownership remains with consumers; no backend changes; assumptions and fidelity boundaries explicit                |
| verify-before-done   | PASS                                    | Actual type checks, lint, 18 tests, application/Storybook builds, pack inspection and Chrome interactions recorded above                                    |
| computer-use         | PASS                                    | Targeted the returned existing Chrome window; observed UI state between actions; saved review images; restored window and zoom                              |

The connector-only design-context and Code Connect steps were replaced by the user's explicit Chrome instruction. They are not represented as successfully executed connector calls. No skill or tool was installed by the governor. The original Python inventory script was unavailable; installed skills and tool metadata supplied discovery coverage. Memory tools were unavailable, so decisions and provenance are retained in these repository documents.

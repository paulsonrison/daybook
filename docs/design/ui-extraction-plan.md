# Shared UI extraction

Approved through skill-governor on 9 November 2026. The user subsequently authorized Chrome inspection in place of the rate-limited Figma connector.

## Goal and boundaries

Extend `@daybook/ui` into a reusable React library. Keep routing, API requests, persistence and financial decisions in consuming applications. Extract the supplied designs; do not implement unrelated product workflows.

## Reference evidence

- Figma file `86N455oNGTMupW2wYsIXkb`, pages `0:1`, `37:418`, `40:418`.
- Chrome export: 17 main frames, 25 recovery frames (including their scope note), 145 complete-state frames.
- Exact native library: `figma/main/Daybook — Native component library.svg`.
- Exact variables inspected in Chrome: ink `#172D2B`, muted `#697775`, teal `#087F73`, background `#F5F6F3`, white `#FFFFFF`, border `#D9E3DE`, skeleton `#E0E8E5`, red `#AD2B30`, amber `#8C5C14`, dark `#2E3440`, light `#E5EDF2`; state gap 16 px.
- Native components use additional explicit values (for example border `#D3DEDA`, destructive `#B13F3F`). Preserve these as separate roles rather than silently merging them.
- Exported frames contain no raster image nodes. Theme thumbnails and icons are vectors.
- Figma connector cannot supply Code Connect mappings or generated code because its Starter quota is exhausted. Browser exports are the authorized implementation source; connector-only skill requirements are waived for this task.

## Implementation sequence

1. **Inventory and source references.** Extract text, geometry, fonts, colors and local vectors. Check: all three pages represented; exports parse as SVG.
2. **Foundations and assets.** Add typed tokens, 15 color presets, light/dark/system display modes, scoped typography, bundled fonts, exact icon assets and public exports. Check: consumers resolve assets and typography without application-specific paths.
3. **Controls and containers.** Extend buttons; add fields, search, select, selection controls, badges, tooltips, cards, tables, tabs, pagination, dates, metrics and dialogs/drawers. Check: keyboard behavior, labels, disabled/pending/error states and long content.
4. **Reusable recovery and billing presentation.** Add loading/skeleton, empty/missing/error/success/offline/partial/retry states, bill summary, payment confirmation and next-record presentation. Check: unknown payment never renders as confirmed; missing data never becomes zero; consumer callbacks own mutations.
5. **Consumer and catalogue.** Add Storybook examples and a frontend `/ui` catalogue using shared exports, themes and typography controls. Apply shared foundations to the existing frontend. Check: package works in both Next.js and Vite/Storybook.
6. **Verification and audit.** Run type checks, lint, meaningful behavior tests, builds, Storybook build and browser interaction/visual checks. Compare to native component and state exports; document limitations and evidence. Review the diff and audit each assigned skill.

## Risks

SVG exports preserve drawing geometry and font metadata but not every auto-layout rule. Responsive behavior and native HTML keyboard interactions need implementation and validation. Only Teal light and Nord dark have full-screen theme references; the other color presets have exact preview palettes, with shared semantic roles. Fonts must actually load before visual comparisons. Static reference SVGs must never replace interactive components in production UI.

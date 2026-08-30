# Draft studio design QA

- Visual source of truth: `/Users/xueyongqi/.codex/generated_images/019fd4f0-684c-79d3-b99e-fde6ece5edae/exec-6090124c-c321-48c3-9b69-0c9adc0014a0.png`
- Implementation screenshot: `/Users/xueyongqi/Documents/ChatGPT/project-10/.artifacts/draft-implementation-selected.png`
- Combined comparison input: `/Users/xueyongqi/Documents/ChatGPT/project-10/.artifacts/draft-comparison-selected.png`
- Comparison viewport: source `1487 × 1058`; implementation `1488 × 1057`
- Comparison state: collapsed global rail, split edit/preview view, article image selected, contextual image actions visible

## Intentional product deviations

- The global rail is 52 px instead of the wider visual-source rail because the user explicitly requested a narrower collapsed navigation.
- The source image keeps its real intrinsic aspect ratio instead of being cropped to the visual-source placeholder ratio.
- Theme selection and explicit save controls remain in the top bar because they are working product functions in the existing application.

## Findings and resolutions

- P0: none.
- P1: TipTap initially crashed when edit and preview instances mounted together. Resolved by guarding destroyed editor instances and synchronizing content without emitting updates.
- P1: mobile split view rendered two unusably narrow columns. Resolved by changing the resizable group to a vertical split at 720 px and below.
- P2: the editor reported unsaved changes immediately after opening. Resolved by suppressing initialization-only editor updates.
- P2: the selected visual included contextual image controls that were absent in the first implementation. Resolved with working Replace, Caption, Align, and Delete actions.
- P2: the publish surface was originally always visible. Resolved with a shared right-side Sources / Images / Versions / Publish drawer that pushes content on wide screens and becomes an overlay on compact screens.

## Interaction checks

- Sidebar: 52 px collapsed, 206 px expanded; state persists locally; Cmd/Ctrl+B works outside editing fields.
- Automation: one primary icon exposes both Scheduled Tasks and Run History.
- Draft library: opens, searches two real drafts, switches drafts, closes by button or Escape.
- View modes: Edit Only, Split, and Preview Only all render the correct panes.
- Split separator: pointer and keyboard resizing both change pane widths.
- Utility drawer: Sources, Images, Versions, and Publish tabs all render; the active rail button toggles the drawer.
- Persistence: editing stops for about one second before autosave; manual and automatic checkpoints survive a full page reload; restore requires a second confirmation and keeps a pre-restore backup.
- Publish: two future platforms remain disabled; the helper states that filling does not publish automatically.
- Responsive: four bottom navigation items; no horizontal page overflow at 390 px; the utility drawer fits the viewport.
- Verification: production build passed; all 9 server tests passed; no new runtime errors in the final build.

final result: passed

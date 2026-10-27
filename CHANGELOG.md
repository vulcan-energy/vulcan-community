# Changelog

Notable changes to Vulcan Community will be recorded here. This changelog starts
with the repository's clean initial import and does not claim releases or history
from earlier private Vulcan development.

## [Unreleased]

### Added

- The `vulcan-community` command line (`apps/cli`): `check`, `thermal-bridges`,
  `convert`, `preflight` and `version`, with `--json` output. No account and no
  simulation (#105, #106).
- Service networks on the canvas: one connectivity rule for ducts and pipes, dog-leg
  routing with tee splits, Snap welds ends, network-aware overlap checks, an auto-duct
  planner with a hold-A preview, multi-storey auto-ducts, and auto primary pipework with
  pipe-to-plant connectivity (#128, #133, #135, #139, #140, #142, #144).
- Undo/Redo that records the saved CSV automatically; New Document is a history
  boundary (#151, #153, #156).
- Thermal bridges can be previewed and added on the 2D and 3D canvas (#127, #130).
- Shape rotation by dragging the direction arrow; window shading follows its host
  through rotations and flips (#47, #49).
- A pitch axis for sloped polygons, with an Orientation fall-line arrow and hinge
  contour that read as controls (#35, #37, #39, #45).
- Snap feedback that shows what was snapped to (#43).
- Alt-drag moves connected walls, ducts and pipes, and carries T-junction stems
  (#136, #138, #149).
- Hover hints and cursors on selected elements; the hovered element is emphasised on the
  canvas and in panel rows (#129, #146, #166).
- Element panels show the selected HEM version's errors before Save, and build errors
  navigate to the element and field (#120, #122).
- Explicit HEM-target CSV migration, and legacy CSVs update automatically on Save
  (#107, #110).
- ModelId/ModelVersion rows and a canonical CSV form that serialises identically from
  every load (#152).
- Hot-water-only and exhaust-air heat pump presets, plus heating performance and cylinder
  configuration fields (#109, #114, #125).
- Warnings for ECaaS-only products, and pre-fix ECaaS product references upgrade on load
  (#112, #117).
- Host extension points: remote-selection and presence overlays (live cursors, drag and
  draw ghosts, colleague discs, follow mode) and files-menu and filename-bar slots. The
  standalone editor does not enable presence (#154, #155, #158–#165).
- `StatusPill` (`@vulcan-community/geometry-editor`): `type` is now optional, so a caller
  can drive colouring purely from the new `tone` prop (`success | error | warning |
  neutral`, colouring from the existing `--status-*` tokens) without claiming one of the
  four provenance types — no `status-pill-<type>` class is emitted and the label falls
  back to nothing unless `labelOverride` is also given. Also adds `size="fixed"` (constant
  height/min-width, centred content) and an `inline` opt-out for the default 8px left
  margin, plus `ariaLabel` for an explicit accessible name. Additive — every existing
  caller passes `type` and none of the new props, so rendering is unchanged.
- `DeleteConfirmModal` (`@vulcan-community/geometry-editor`): `role="dialog"`,
  `aria-modal="true"`, `aria-labelledby` on the title, a focus trap, and an
  `initialFocus` (`'cancel' | 'confirm'`, defaults to `'cancel'`) prop. `Enter` now
  confirms only via keyboard activation of the confirm button itself, never from the
  backdrop/document; `Escape` cancels from anywhere; focus returns to the opener on
  close.

### Changed

- Advanced Fields render directly from the schema; the JsonForms dependency is retired
  (#38, #40–#42, #44, #55, #58, #60).
- Automatic thermal-bridge junction families are keyed off floor-element evidence rather
  than storey index (#24, #26, #28, #32, #33, #118).
- Opaque profiled-top walls render as solid wall-thickness prisms (#20).
- Pitch accepts decimals, as the schemas always allowed (#31).
- Override provenance is authored explicitly rather than inferred from values (#51, #53).
- Defaults editing is a single Community surface (#61).
- Systems rows combine by name, without guessed repoints (#104).
- Floor bases are editable and floor stacks are validated (#64, #65, #67, #68, #98).

### Fixed

- A blank CSV `pitch` no longer inherits the defaults template's pitch, which made
  internal walls horizontal. A two-point base line is a vertical wall (90), a ground
  element a floor (180), and any other blank-pitch row fails with E061 (#171).
- Dimension overrides, storey heights and manual element names persist across save and
  load (#21, #25, #27, #29).
- Cleared Advanced Fields no longer reach the merged HEM JSON, and System Advanced Fields
  validate their leaf values (#56, #57).
- Annex F and ventilated-cavity corrections now reach HEM; repeating bridges survive
  loading saved assemblies (#80, #119).
- a7 U-value meaning is preserved, and legacy window openings convert to a8/a9 with the
  a7 airflow height (#115, #123).
- Zone moves carry hosted openings and shading; scoped mutations keep window security
  overrides (#100–#102).
- Split ground floor areas aggregate correctly, and selecting one no longer crashes
  (#70, #73, #75).
- Selections that refer to deleted geometry are cleared (#87).
- Doors and pitched walls are excluded from zone height (#6).
- Canvas labels avoid chips and distance pills; Alt-drag no longer toggles Firefox's menu
  bar (#145, #148).

## [1.0.0] - 2026-07-31

### Added

- The public source tree for the offline-first 2D/3D building-geometry
  editor and its HEM/FHS input-authoring packages.
- Local workspace and file handling, CSV/model codecs, schema and reference-data
  assets, standalone JavaScript and Rust checks, and the initial governance files.
- Optional, user-fetched IFC import with pinned provenance and hash verification.

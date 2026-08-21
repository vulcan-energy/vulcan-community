# Changelog

Notable changes to Vulcan Community will be recorded here. This changelog starts
with the repository's clean initial import and does not claim releases or history
from earlier private Vulcan development.

## [Unreleased]

### Added

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

## [1.0.0] - 2026-07-31

### Added

- The public source tree for the offline-first 2D/3D building-geometry
  editor and its HEM/FHS input-authoring packages.
- Local workspace and file handling, CSV/model codecs, schema and reference-data
  assets, standalone JavaScript and Rust checks, and the initial governance files.
- Optional, user-fetched IFC import with pinned provenance and hash verification.

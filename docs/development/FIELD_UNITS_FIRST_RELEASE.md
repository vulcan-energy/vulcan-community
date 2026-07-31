# Persistent field units: first-release scope

Persistent trailing unit adornments apply to numeric model-authoring controls in
the shared editor shell: standard element fields, bulk edit rows, advanced
JsonForms controls, fabric defaults, global/compliance fields, zone-derived
numbers, and inventory editors embedded in those surfaces. The adornment is
presentation only. It is never appended to the control value and therefore
does not enter events, validation, CSV, defaults JSON, or generated HEM input.

The completeness audit discovers schema-backed numeric fields from the
canonical Core/FHS schemas and discovers UI-only numeric fields from
`TOOLTIP_OVERRIDES` entries marked `modelAuthoring`. The test does not maintain
a second field/unit registry.

## Deferred specialist controls

The following calculator and canvas controls are intentionally outside the
first release. They do not use the shared model-field row layout, and several
edit temporary geometric or calculator state rather than one canonical model
property. Their existing values and serialization are unchanged.

- Specialist calculators: `AssemblyCalculatorModal`,
  `GroundUValueCalculatorModal`, and `UnheatedSpaceRuCalculator`.
- Overlay and floor tools using `DraftSafeNumberInput`:
  `OverlayPdfImportModal`, `OverlayPanel`, and `FloorPickerDropdown`.
- Canvas/geometry inputs: `CompassRose`, `ProfileHeightsPopover`,
  `OrthogonalRoomEditModal`, and the draw/segment editors in `GeometryCanvas`.
- Multi-selection geometry operations: snap/trim tolerance, right-angle
  tolerance, and rotation angle.

Adding persistent adornments to these controls needs a separate layout and
keyboard/screen-reader pass for compact overlays, calculator tables, and
in-canvas editors. They must use the canonical field-presentation resolver
where they correspond to a model property; operation-only values should use
explicit operation metadata rather than being added to model-field metadata.

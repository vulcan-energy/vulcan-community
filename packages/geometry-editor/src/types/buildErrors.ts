// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { GeometryProductSlot } from '../../../geometry-editor-host/src/inspectorContributions';

export type BuildErrorItem = {
  source: 'schema' | 'part_f_preflight' | 'fhs_preflight' | 'build';
  message: string;
  path?: string;
  code?: string;
  category?: string;
  userMessage?: string;
  technicalMessage?: string;
  schemaPath?: string;
  keyword?: string;
  /** Non-blocking: shown as a warning, never counted against Save or run. */
  severity?: 'warning';
};

/** Validation by the selected HEM target, e.g. `{ hemVersion: '1.0.0a8', items }`. */
export type TargetValidation = {
  hemVersion: string;
  items: readonly BuildErrorItem[];
  /** Systems that need a product, when the target's conversion uses products. */
  productSlots?: readonly GeometryProductSlot[];
  /** An existing building's distant shading as the target's conversion made it (EPC). */
  distantShading?: DistantShading;
  /** An existing building's ventilation zone height as the target's conversion worked it out from the drawing (EPC); none when the model states it. */
  ventilationZoneHeight?: number;
  /** The conversion's values for system fields, for pickers and placeholders (EPC). */
  systemDefaults?: TargetSystemDefaults;
  /** The storeys in the dwelling as the conversion counts them (an existing building's own count). */
  storeysInDwelling?: number;
  /** The built form the conversion sends (an HEM:EPC `General.build_type`), worked out from the party walls. */
  builtForm?: string;
};

/** What the target's conversion offers or derives for system fields. */
export type TargetSystemDefaults = Readonly<{
  /** The curves a heating control may pick (`weather_compensation_curve_id`), each with the heat source and emitter types an existing building takes it for when it states none. */
  weatherCurves: readonly Readonly<{ id: number; gradient: number; default_for: readonly Readonly<{ heat_source_type: string; wet_emitter_type: string }>[] }>[];
  /** The default the conversion uses for a field the model leaves blank, by the system's model path (as product slots name it). */
  derived: readonly Readonly<{ path: string; field: string; value: unknown }>[];
}>;

/** One of the four distant shading quadrants, as converted. */
export type DistantShadingQuadrant = Readonly<{
  /** The segment key the stated row is keyed by. */
  key: string;
  /** Front, Right, Back or Left, looking out of the front door. */
  name: string;
  /** Bearing of the quadrant's centre (degrees). */
  centre: number;
  shading_fraction: string;
  source: 'stated' | 'drawn' | 'none';
  /** The band the drawing gives; absent when nothing is drawn there. */
  drawn?: string;
  roof_shading: boolean;
  roof_source: 'stated' | 'drawn' | 'none';
  drawn_roof?: boolean;
}>;

export type DistantShading = Readonly<{
  reference_orientation: number;
  quadrants: readonly DistantShadingQuadrant[];
  /** Context Shading rows wholly in stated quadrants: they change nothing sent. */
  unused_objects?: readonly string[];
}>;

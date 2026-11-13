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
};

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

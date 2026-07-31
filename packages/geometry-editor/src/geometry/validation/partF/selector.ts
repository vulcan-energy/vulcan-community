// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Adapter: builds a Part F detection context from the unified effective-dwelling-details
// resolver. The resolver does the override → space-labels → derivation chain; this file
// just re-shapes the result to the PartFDetectionContext type that detectMissingElements
// already accepts. Plus a one-call helper `selectPartFData` that wraps the full
// resolver → input → evaluate pipeline so callers don't have to remember the three steps.

import {
  resolveEffectiveDwellingDetails,
  type EffectiveDwellingDetailsInputs,
} from '../../../lib/effectiveDwellingDetails';
import type { PartFDetectionContext } from '../detectMissingElements';
import { evaluatePartF, partFInputFromContext, type PartFFinding } from './rules';
import {
  createDefaultsLookup,
  getDefaultValueForElementField,
  getMechVentDefaultByVentType,
  type DefaultsLookup,
} from '../../../lib/defaultsCache';
import type { Element, MechanicalVentilation } from '../../types';

export function resolveEffectivePartFContext(
  input: EffectiveDwellingDetailsInputs,
): PartFDetectionContext {
  const dd = resolveEffectiveDwellingDetails(input);
  return {
    spaceLabels: dd.primaryZoneSpaceLabels,
    totalFloorAreaM2: dd.totalFloorAreaM2,
    bedrooms: dd.bedrooms,
    habitableRooms: dd.habitableRooms,
    wetRooms: dd.wetRooms,
    bathrooms: dd.bathrooms,
    utilityRooms: dd.utilityRooms,
    sanitaryAccommodations: dd.sanitaryAccommodations,
    storeys: dd.storeysInDwelling,
    isKitchenVentExternal: dd.isKitchenVentExternal,
  };
}

export interface PartFDataBundle {
  /** Detection context (passed to `detectMissingElements`); always defined when compliance is on. */
  context: PartFDetectionContext;
  /** Findings (passed to `validateElement` for per-element issues). Empty when nothing fires
   *  or when prerequisites aren't met (missing counts, no real elements, etc.). */
  findings: PartFFinding[];
}

/**
 * One-call data bundle for callers that need both the detection context AND the per-element
 * findings. Wraps the resolver → input → evaluate pipeline so the wiring can't drift between
 * call sites — this prevents the missing-context "no Part F pills" regression where one
 * caller omitted context that another caller already supplied.
 *
 * Reads element-level defaults (Vents area, MV flow per vent_type) from the global
 * `defaultsCache` here so the pure `partFInputFromContext` doesn't have to know about it.
 * Tests can call `partFInputFromContext` directly with synthetic `defaults` argument.
 */
export function selectPartFData(
  input: EffectiveDwellingDetailsInputs & {
    elements: Element[];
    defaults?: unknown | null;
    defaultsLookup?: DefaultsLookup;
  },
): PartFDataBundle {
  const context = resolveEffectivePartFContext(input);
  const explicitDefaults = Object.prototype.hasOwnProperty.call(input, 'defaults');
  const defaultsLookup = input.defaultsLookup ?? (
    explicitDefaults ? createDefaultsLookup(input.defaults ?? null) : null
  );
  const ventArea = defaultsLookup
    ? defaultsLookup.getDefaultValueForElementField('area_cm2', 'Vents')
    : getDefaultValueForElementField('area_cm2', 'Vents');
  const partFInput = partFInputFromContext(context, input.elements, {
    ventArea: typeof ventArea === 'number' ? ventArea : undefined,
    mechVentFlowFor: (ventType: MechanicalVentilation['vent_type']) => {
      const v = defaultsLookup
        ? defaultsLookup.getMechVentDefaultByVentType('design_outdoor_air_flow_rate', ventType)
        : getMechVentDefaultByVentType('design_outdoor_air_flow_rate', ventType);
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    },
  });
  const findings = partFInput ? evaluatePartF(partFInput) : [];
  return { context, findings };
}

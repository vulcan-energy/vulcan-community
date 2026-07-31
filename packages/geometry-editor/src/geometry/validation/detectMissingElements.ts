// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, ElementType, SpaceLabel, Zone } from '../types';
import type { MissingElement } from './types';
import {
  evaluatePartF,
  partFInputFromContext,
  planBackgroundVents,
  type PartFFinding,
  type PartFInput,
} from './partF';

const BUILDING_ELEMENT_TYPES: ElementType[] = [
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementGround',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
];

const THERMAL_BRIDGE_TYPES: ElementType[] = [
  'ThermalBridgeLinear',
  'ThermalBridgePoint',
];

export const hasPositiveDefaultThermalBridging = (
  defaultThermalBridging?: number
): boolean => typeof defaultThermalBridging === 'number'
  && Number.isFinite(defaultThermalBridging)
  && defaultThermalBridging > 0;

export const zoneHasDetailedThermalBridging = (
  zoneId: string,
  elementsById: Record<string, Element>
): boolean => Object.values(elementsById).some((el) =>
  el.zoneId === zoneId
  && !el.isPlaceholder
  && (THERMAL_BRIDGE_TYPES as string[]).includes(el.type)
);

export const zoneHasThermalBridging = (
  zone: Zone,
  elementsById: Record<string, Element>,
  _defaultThermalBridging?: number
): boolean => {
  void _defaultThermalBridging;
  return zone.simplifiedThermalBridging || zoneHasDetailedThermalBridging(zone.id, elementsById);
};

/** HotWaterDemand rows that count as shower or bath for FHS (avoids synthetic HW drawoff naming issues). */
const SHOWER_OR_BATH_SUBCATEGORIES = new Set(['MixerShower', 'InstantElecShower', 'Bath']);
const SHOWER_SUBCATEGORIES = new Set(['MixerShower', 'InstantElecShower']);
const FHS_HOT_WATER_SOURCE_TYPES = new Set([
  'StorageTank',
  'SmartHotWaterTank',
  'CombiBoiler',
  'PointOfUse',
  'HIU',
  'HeatBattery',
]);

function extraJsonRecord(extra: unknown): Record<string, unknown> | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  return extra as Record<string, unknown>;
}

export function systemElementProvidesHotWaterSource(element: Element): boolean {
  if (element.isPlaceholder || element.type !== 'System') return false;
  const subcategory = (element as { subcategory?: string }).subcategory;
  if (subcategory !== 'HotWaterSource' && subcategory !== 'HeatSourceWet') return false;
  const extra = extraJsonRecord((element as { extra_json?: unknown }).extra_json);
  if (!extra) return false;

  const wrappedHotWaterSource = extraJsonRecord(extra.HotWaterSource);
  if (wrappedHotWaterSource) {
    return Object.entries(wrappedHotWaterSource).some(([name, value]) => {
      const source = extraJsonRecord(value);
      return name.trim() !== ''
        && typeof source?.type === 'string'
        && FHS_HOT_WATER_SOURCE_TYPES.has(source.type);
    });
  }

  // The model transform also accepts a legacy flat payload for an explicit
  // HotWaterSource System row and wraps it under the element name.
  return subcategory === 'HotWaterSource'
    && typeof extra.type === 'string'
    && FHS_HOT_WATER_SOURCE_TYPES.has(extra.type);
}

export function systemElementProvidesHeatSourceWet(element: Element): boolean {
  if (element.isPlaceholder || element.type !== 'System') return false;
  if ((element as { subcategory?: string }).subcategory === 'HeatSourceWet') return true;
  const extra = extraJsonRecord((element as { extra_json?: unknown }).extra_json);
  const heatSourceWet = extra?.HeatSourceWet;
  return !!(heatSourceWet && typeof heatSourceWet === 'object' && !Array.isArray(heatSourceWet));
}

export function systemElementProvidesSpaceHeatSystem(element: Element): boolean {
  if (element.isPlaceholder || element.type !== 'System') return false;
  if ((element as { subcategory?: string }).subcategory !== 'SpaceHeatSystem') return false;
  const extra = extraJsonRecord((element as { extra_json?: unknown }).extra_json);
  const spaceHeatSystem = extra?.SpaceHeatSystem;
  if (!spaceHeatSystem || typeof spaceHeatSystem !== 'object' || Array.isArray(spaceHeatSystem)) {
    return false;
  }
  return Object.entries(spaceHeatSystem as Record<string, unknown>).some(([name, value]) =>
    name.trim() !== '' && !!value && typeof value === 'object' && !Array.isArray(value)
  );
}

/** All named keys present under any System `extra_json.HeatSourceWet` (dwelling plant). */
export function collectDefinedHeatSourceWetKeys(elements: Element[]): Set<string> {
  const keys = new Set<string>();
  for (const el of elements) {
    if (el.isPlaceholder || el.type !== 'System') continue;
    const extra = extraJsonRecord((el as { extra_json?: unknown }).extra_json);
    const hsw = extra?.HeatSourceWet;
    if (hsw && typeof hsw === 'object' && !Array.isArray(hsw)) {
      for (const k of Object.keys(hsw as Record<string, unknown>)) {
        if (k) {
          keys.add(k);
        }
      }
    }
  }
  return keys;
}

/**
 * True when some `HotWaterSource` entry references a dwelling `HeatSourceWet` by name, but
 * that name is not defined on any system (or, for Combi/HIU/HeatBattery, no `HeatSourceWet` string
 * and no `HeatSourceWet` system at all). No reference ⇒ no extra dwelling wet plant is implied
 * (e.g. immersion-only storage).
 */
export function hotWaterSourceReferencesUnsatisfiedHeatSourceWet(
  elements: Element[],
  definedKeys?: Set<string>,
): boolean {
  const defined = definedKeys ?? collectDefinedHeatSourceWetKeys(elements);
  const hasAnyHsw = elements.some(systemElementProvidesHeatSourceWet);
  for (const el of elements) {
    if (el.isPlaceholder || el.type !== 'System') continue;
    const extra = extraJsonRecord((el as { extra_json?: unknown }).extra_json);
    const hwsRoot = extra?.HotWaterSource;
    if (!hwsRoot || typeof hwsRoot !== 'object' || Array.isArray(hwsRoot)) continue;

    for (const hw of Object.values(hwsRoot as Record<string, unknown>)) {
      if (!hw || typeof hw !== 'object' || Array.isArray(hw)) continue;
      const rec = hw as Record<string, unknown>;
      const t = rec.type;
      if (t === 'CombiBoiler' || t === 'HIU' || t === 'HeatBattery') {
        const ref = rec.HeatSourceWet;
        if (typeof ref === 'string' && ref.trim()) {
          if (!defined.has(ref.trim())) {
            return true;
          }
        } else if (!hasAnyHsw) {
          return true;
        }
        continue;
      }
      if (t === 'StorageTank' || t === 'SmartHotWaterTank') {
        const heatSource = rec.HeatSource;
        if (heatSource && typeof heatSource === 'object' && !Array.isArray(heatSource)) {
          for (const [subKey, hs] of Object.entries(heatSource as Record<string, unknown>)) {
            if (!hs || typeof hs !== 'object' || Array.isArray(hs)) continue;
            const hst = (hs as { type?: string }).type;
            if (hst === 'HeatSourceWet') {
              const name = (hs as { name?: string }).name;
              const key = (typeof name === 'string' && name.trim() ? name.trim() : subKey) || subKey;
              if (key && !defined.has(key)) {
                return true;
              }
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * FHS: `HotWaterSource` entries that reference a named dwelling `HeatSourceWet` must use a
 * name that exists under some system’s `extra_json.HeatSourceWet`. For per-row feedback in the
 * inspector (in addition to dwelling “missing” pills).
 */
export function hotWaterSourceHeatSourceWetLinkMessagesForElement(
  element: Element,
  allElements: Element[],
): string[] {
  const defined = collectDefinedHeatSourceWetKeys(allElements);
  const hasAnyHsw = allElements.some(systemElementProvidesHeatSourceWet);
  const messages: string[] = [];
  if (element.isPlaceholder || element.type !== 'System') return messages;
  const extra = extraJsonRecord((element as { extra_json?: unknown }).extra_json);
  const hwsRoot = extra?.HotWaterSource;
  if (!hwsRoot || typeof hwsRoot !== 'object' || Array.isArray(hwsRoot)) return messages;

  for (const [entryKey, hw] of Object.entries(hwsRoot as Record<string, unknown>)) {
    if (!hw || typeof hw !== 'object' || Array.isArray(hw)) continue;
    const rec = hw as Record<string, unknown>;
    const t = rec.type;
    if (t === 'CombiBoiler' || t === 'HIU' || t === 'HeatBattery') {
      const ref = rec.HeatSourceWet;
      if (typeof ref === 'string' && ref.trim()) {
        if (!defined.has(ref.trim())) {
          messages.push(
            `Hot water (“${entryKey}”) points to heat source (wet) “${ref.trim()}”, which is not defined. Add a heat source (wet) with that name or change the link.`,
          );
        }
      } else if (!hasAnyHsw) {
        messages.push(
          'Hot water requires a heat source (wet) when no link name is set (add a heat source (wet) system).',
        );
      }
    } else if (t === 'StorageTank' || t === 'SmartHotWaterTank') {
      const heatSource = rec.HeatSource;
      if (heatSource && typeof heatSource === 'object' && !Array.isArray(heatSource)) {
        for (const [subKey, hs] of Object.entries(heatSource as Record<string, unknown>)) {
          if (!hs || typeof hs !== 'object' || Array.isArray(hs)) continue;
          const hst = (hs as { type?: string }).type;
          if (hst === 'HeatSourceWet') {
            const name = (hs as { name?: string }).name;
            const key = (typeof name === 'string' && name.trim() ? name.trim() : subKey) || subKey;
            if (key && !defined.has(key)) {
              messages.push(
                `Hot water tank heat source “${key}” is not defined under heat source (wet). Add a matching plant or rename the link.`,
              );
            }
          }
        }
      }
    }
  }
  return messages;
}

/**
 * Optional Part F context. When all fields are provided AND `complianceValidationEnabled` is
 * true, Part F sufficiency findings (insufficient background vent area / count, MV flow gaps,
 * MVHR-without-vents conflicts, etc.) are appended as MissingElement rows with batched
 * placement plans. When omitted, the existing presence-only checks behave as before.
 */
export interface PartFDetectionContext {
  spaceLabels: SpaceLabel[];
  totalFloorAreaM2: number;
  bedrooms?: number;
  habitableRooms?: number;
  wetRooms?: number;
  bathrooms?: number;
  utilityRooms?: number;
  sanitaryAccommodations?: number;
  storeys?: number;
  isKitchenVentExternal?: boolean;
}

// Detect missing required elements for zones based on the FHS schema
export const detectMissingElements = (
  zones: Zone[],
  elementsById: Record<string, Element>,
  complianceValidationEnabled: boolean,
  defaultThermalBridging?: number,
  partOActiveCoolingRequired?: boolean,
  partFContext?: PartFDetectionContext,
): MissingElement[] => {
  if (!complianceValidationEnabled) return [];

  const elements = Object.values(elementsById);
  const hasAnyRealElements = elements.some((el) => !el.isPlaceholder);

  const dwellingWide: MissingElement[] = [];
  if (hasAnyRealElements) {
    const hasAnyWetEmitter = elements.some((el) => !el.isPlaceholder && el.type === 'WetEmitter');
    const hasHeatSourceWetSystem = elements.some(systemElementProvidesHeatSourceWet);
    if (hasAnyWetEmitter && !hasHeatSourceWetSystem) {
      dwellingWide.push({
        type: 'System',
        requiredBy: 'fhs',
        path: '/HeatSourceWet',
        message: 'FHS: Heat source (wet) required when Wet Emitters are present',
        pillQualifier: 'Heat source (wet)',
      });
    }

    const hasMechanicalVentilation = elements.some((el) =>
      !el.isPlaceholder && el.type === 'MechanicalVentilation'
    );
    if (!hasMechanicalVentilation) {
      dwellingWide.push({
        type: 'MechanicalVentilation',
        requiredBy: 'fhs',
        path: '/InfiltrationVentilation/MechanicalVentilation',
        message: 'FHS: Mechanical ventilation system',
        pillQualifier: 'Mechanical ventilation',
      });
    }

    const hasAppliance = elements.some(
      (el) => !el.isPlaceholder && el.type === 'Appliance',
    );
    if (!hasAppliance) {
      dwellingWide.push({
        type: 'Appliance',
        requiredBy: 'fhs',
        path: '/Appliances',
        message: 'FHS: Appliances (internal gains / loads)',
        pillQualifier: 'Appliances',
      });
    } else {
      const hasRequiredRefrigerationAppliance = elements.some((el) => {
        if (el.isPlaceholder || el.type !== 'Appliance') return false;
        const applianceKey = (el as { appliancekey?: unknown }).appliancekey;
        return applianceKey === 'Fridge' || applianceKey === 'Fridge-Freezer';
      });
      if (!hasRequiredRefrigerationAppliance) {
        dwellingWide.push({
          type: 'Appliance',
          requiredBy: 'fhs',
          path: '/Appliances/FridgeOrFridgeFreezer',
          message: 'Add a Fridge or Fridge-Freezer appliance — FHS requires at least one.',
          pillQualifier: 'Fridge or fridge-freezer',
        });
      }
    }

    const hasHotWaterSource = elements.some(systemElementProvidesHotWaterSource);
    if (!hasHotWaterSource) {
      dwellingWide.push({
        type: 'System',
        requiredBy: 'fhs',
        path: '/HotWaterSource',
        message: 'FHS: Hot water source',
        pillQualifier: 'Hot water source',
      });
    } else if (hotWaterSourceReferencesUnsatisfiedHeatSourceWet(elements)) {
      dwellingWide.push({
        type: 'System',
        requiredBy: 'fhs',
        path: '/HeatSourceWet',
        message: 'FHS: Heat source (wet) required by hot water source',
        pillQualifier: 'Heat source (wet)',
      });
    }

    // FHS notional preprocessor: multi-storey dwellings add notional WWHRS to
    // HotWaterDemand.Shower entries. A bath is enough for DHW event mapping,
    // but not for the notional WWHRS shower link.
    const hasShowerHotWater = elements.some(
      (el) =>
        !el.isPlaceholder
        && el.type === 'HotWaterDemand'
        && SHOWER_SUBCATEGORIES.has((el as { subcategory?: string }).subcategory ?? ''),
    );
    const needsNotionalWwhrsShower =
      typeof partFContext?.storeys === 'number'
      && Number.isFinite(partFContext.storeys)
      && partFContext.storeys > 1;
    if (needsNotionalWwhrsShower && !hasShowerHotWater) {
      dwellingWide.push({
        type: 'HotWaterDemand',
        requiredBy: 'fhs',
        path: '/HotWaterDemand/Shower',
        message:
          'FHS: Add a shower for multi-storey compliance so the notional WWHRS wrapper can attach to HotWaterDemand.Shower.',
        pillQualifier: 'Shower',
      });
    }

    // FHS preprocessor: if both Shower and Bath are empty it synthesises drawoffs named "other",
    // which then must exist under HotWaterDemand.Other — requiring a real shower or bath avoids that path.
    const hasShowerOrBathHotWater = elements.some(
      (el) =>
        !el.isPlaceholder
        && el.type === 'HotWaterDemand'
        && SHOWER_OR_BATH_SUBCATEGORIES.has((el as { subcategory?: string }).subcategory ?? ''),
    );
    if (!needsNotionalWwhrsShower && !hasShowerOrBathHotWater) {
      dwellingWide.push({
        type: 'HotWaterDemand',
        requiredBy: 'fhs',
        path: '/HotWaterDemand/ShowerOrBath',
        message:
          'FHS: Add at least one shower (mixer or instantaneous electric) or a bath so hot water events map to real outlets.',
        pillQualifier: 'Shower or bath',
      });
    }

    // input_fhs.schema.json → HotWaterDemand: required includes "Other", and Other has minProperties 1.
    // Geometry maps that to HotWaterDemand elements with subcategory OtherWaterUseDetails (CSV "Other").
    const hasOtherHotWaterTap = elements.some(
      (el) =>
        !el.isPlaceholder
        && el.type === 'HotWaterDemand'
        && (el as { subcategory?: string }).subcategory === 'OtherWaterUseDetails',
    );
    if (!hasOtherHotWaterTap) {
      dwellingWide.push({
        type: 'HotWaterDemand',
        requiredBy: 'fhs',
        path: '/HotWaterDemand/Other',
        message: 'FHS: Other hot water (at least one tap / outlet)',
        pillQualifier: 'Other outlet',
      });
    }
  }

  const perZone: MissingElement[] = [];
  zones.forEach(zone => {
    const zoneElements = elements.filter(el => el.zoneId === zone.id && !el.isPlaceholder);

    // Skip zones with no elements yet to avoid noisy validation on empty zones
    if (zoneElements.length === 0) return;

    const hasLighting = zoneElements.some(el => el.type === 'Lighting');
    if (!hasLighting) {
      perZone.push({
        type: 'Lighting',
        zoneId: zone.id,
        requiredBy: 'fhs',
        path: `/Zone/${zone.name}/Lighting`,
        message: 'FHS: Lighting',
        pillQualifier: 'Lighting',
      });
    }

    const hasBuildingElement = zoneElements.some(el =>
      (BUILDING_ELEMENT_TYPES as string[]).includes(el.type)
    );
    if (!hasBuildingElement) {
      perZone.push({
        type: 'BuildingElementOpaque',
        zoneId: zone.id,
        requiredBy: 'fhs',
        path: `/Zone/${zone.name}/BuildingElement`,
        message: 'FHS: Wall, floor, or roof',
        pillQualifier: 'Fabric',
      });
    }

    const hasThermalBridging = zoneHasThermalBridging(zone, elementsById, defaultThermalBridging);
    if (!hasThermalBridging) {
      perZone.push({
        type: 'ThermalBridgeLinear',
        zoneId: zone.id,
        requiredBy: 'fhs',
        path: `/Zone/${zone.name}/ThermalBridging`,
        message: 'FHS: TB or simplified ψ',
        pillQualifier: 'Thermal bridging',
        fieldKey: 'simplifiedThermalBridging',
      });
    }

    const hasSpaceHeatingSystem = zoneElements.some(systemElementProvidesSpaceHeatSystem);
    if (!hasSpaceHeatingSystem) {
      perZone.push({
        type: 'System',
        zoneId: zone.id,
        requiredBy: 'fhs',
        path: `/Zone/${zone.name}/SpaceHeatSystem`,
        message: 'FHS: Space heating system',
        pillQualifier: 'Space heating',
      });
    }

    if (partOActiveCoolingRequired) {
      const hasSpaceCoolingSystem = zoneElements.some((el) =>
        el.type === 'System' && (el as any).subcategory === 'SpaceCoolSystem'
      );
      if (!hasSpaceCoolingSystem) {
        perZone.push({
          type: 'System',
          zoneId: zone.id,
          requiredBy: 'fhs',
          path: `/Zone/${zone.name}/SpaceCoolSystem`,
          message: 'FHS: Space cooling system',
          pillQualifier: 'Space cooling',
        });
      }
    }
  });

  // Part F sufficiency findings (insufficient background vent area, MV flow gaps, etc.).
  // Only emitted when the caller passes a complete partFContext; otherwise we stay in
  // presence-only mode for backwards compatibility.
  const partFRows: MissingElement[] = [];
  if (hasAnyRealElements && partFContext) {
    const partFInput = partFInputFromContext(partFContext, elements);
    if (partFInput) {
      const findings = mergeBackgroundFindings(evaluatePartF(partFInput));
      for (const finding of findings) {
        const row = missingElementForPartFFinding(finding, partFInput, elements, partFContext.spaceLabels);
        if (row) partFRows.push(row);
      }
    }
  }

  // Dwelling-wide first so UI lists (and scroll regions) show dwelling checks before per-zone rows.
  return [...dwellingWide, ...perZone, ...partFRows];
};

/**
 * Background vent area + count for the same pathway both fix-by the same batched CTA
 * (planBackgroundVents always closes count AND area together). Two pills with identical
 * onClick is noise — collapse to one whose label combines both gaps.
 *
 * Findings remain individually emitted by evaluatePartF (parity with upstream's separate
 * area/count assertions); this merge happens at the UI-presentation boundary.
 */
function mergeBackgroundFindings(findings: PartFFinding[]): PartFFinding[] {
  const out: PartFFinding[] = [];
  const seenPathways = new Set<PartFFinding['pathway']>();
  for (const f of findings) {
    const isAreaRule =
      f.rule === 'background_area_continuous' || f.rule === 'background_area_intermittent';
    const isCountRule =
      f.rule === 'background_count_continuous' || f.rule === 'background_count_intermittent';
    if (!isAreaRule && !isCountRule) {
      out.push(f);
      continue;
    }
    if (seenPathways.has(f.pathway)) continue; // already merged for this pathway
    seenPathways.add(f.pathway);

    const partner = findings.find(
      (g) =>
        g !== f &&
        g.pathway === f.pathway &&
        ((isAreaRule && (g.rule === 'background_count_continuous' || g.rule === 'background_count_intermittent')) ||
          (isCountRule && (g.rule === 'background_area_continuous' || g.rule === 'background_area_intermittent'))),
    );
    if (!partner) {
      out.push(f);
      continue;
    }
    const area = isAreaRule ? f : partner;
    const count = isCountRule ? f : partner;
    out.push({
      // The merged finding uses the area rule as the primary key (so the placement plan
      // sizes for area), but the label and message reflect both gaps.
      ...area,
      shortLabel: `${count.supplied} / ${count.required} vents · ${area.supplied} / ${area.required} cm²`,
      fullMessage:
        `Part F (${area.pathway} pathway): need ${count.required} background vents totalling ` +
        `${area.required} cm² of free area. Current: ${count.supplied} vent${count.supplied === 1 ? '' : 's'}, ` +
        `${area.supplied} cm² total.`,
    });
  }
  return out;
}

/**
 * Maps a Part F finding to a MissingElement pill, or returns null when "add a new element" is
 * the wrong action. Per-element ValidationIssues already cover the remaining rules:
 *
 *   - background_*           → Vents pill with a batched placement plan (add N vents)
 *   - imev_count             → MechanicalVentilation pill (add one more iMEV)
 *   - decentralised_cmev_count → MechanicalVentilation pill (add one more decentralised cMEV)
 *   - whole_dwelling_*       → null. Rule only fires when MVs exist; user resizes via the
 *                              per-element issue. Adding a second MV doesn't fix an undersized one.
 *   - large_imev             → null. Sizing fix on existing iMEV, not a new element.
 *   - mvhr_no_background_vents → null. Deletion fix on existing vents.
 */
function missingElementForPartFFinding(
  finding: PartFFinding,
  partFInput: PartFInput,
  elements: Element[],
  spaceLabels: SpaceLabel[],
): MissingElement | null {
  if (finding.rule.startsWith('background_')) {
    const batchPlan = planBackgroundVents(finding, partFInput, { elements, spaceLabels });
    return {
      type: 'Vents',
      requiredBy: 'fhs',
      path: `/InfiltrationVentilation/${finding.rule}`,
      message: finding.fullMessage,
      pillQualifier: finding.shortLabel,
      batchPlan: batchPlan || undefined,
    };
  }

  if (finding.rule === 'imev_count' || finding.rule === 'decentralised_cmev_count') {
    return {
      type: 'MechanicalVentilation',
      requiredBy: 'fhs',
      path: `/InfiltrationVentilation/${finding.rule}`,
      message: finding.fullMessage,
      pillQualifier: finding.shortLabel,
    };
  }

  // whole_dwelling_*, large_imev, mvhr_no_background_vents → per-element only.
  return null;
}

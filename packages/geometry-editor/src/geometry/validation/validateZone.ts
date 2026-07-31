// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Zone } from '../types';
import type { ValidationIssue, ValidationResult } from './types';
import {
  hasPositiveDefaultThermalBridging,
  zoneHasDetailedThermalBridging,
} from './detectMissingElements';
import { getZoneFloorLevelsMissingTfa } from '../../lib/zoneDerivation';

export type ZoneValidationContext = {
  elementsById?: Record<string, Element>;
  complianceValidationEnabled?: boolean;
  defaultThermalBridging?: number;
  primaryFhsZoneId?: string;
};

export const validateZone = (zone: Zone, context: ZoneValidationContext = {}): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const primaryFhsZoneId = context.primaryFhsZoneId;
  const isPrimaryFhsZone =
    context.complianceValidationEnabled && primaryFhsZoneId && zone.id === primaryFhsZoneId;

  const issue = (message: string, fieldKey?: string): ValidationIssue => ({ message, fieldKey, source: 'geometry' });
  const warn = (message: string, fieldKey?: string): ValidationIssue => ({ message, fieldKey, source: 'geometry' });
  const fhsIssue = (message: string, fieldKey?: string): ValidationIssue => ({ message, fieldKey, source: 'fhs' });
  const isPositiveFinite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

  if (!zone.name || zone.name.trim() === '') {
    issues.push(issue('Name is required', 'name'));
  }
  if (!isPositiveFinite(zone.floorArea)) {
    issues.push(issue('Floor Area cannot be 0', 'floorArea'));
  }
  if (!isPositiveFinite(zone.height)) {
    issues.push(issue('Height cannot be 0', 'height'));
  }
  if (!isPositiveFinite(zone.volume)) {
    issues.push(issue('Volume cannot be 0', 'volume'));
  }

  if (isPrimaryFhsZone) {
    const livingroomArea = zone.livingroom_area;
    const restOfDwellingArea = zone.restofdwelling_area;
    const hasLivingroomArea = typeof livingroomArea === 'number' && Number.isFinite(livingroomArea);
    const hasRestOfDwellingArea =
      typeof restOfDwellingArea === 'number' && Number.isFinite(restOfDwellingArea);

    if (!hasLivingroomArea) {
      issues.push(fhsIssue('FHS: livingroom_area is required on the first zone', 'livingroom_area'));
    }
    if (!hasRestOfDwellingArea) {
      issues.push(
        fhsIssue('FHS: restofdwelling_area is required on the first zone', 'restofdwelling_area'),
      );
    }
    if (hasLivingroomArea && livingroomArea! < 0) {
      issues.push(fhsIssue('FHS: livingroom_area cannot be negative', 'livingroom_area'));
    }
    if (hasRestOfDwellingArea && restOfDwellingArea! < 0) {
      issues.push(fhsIssue('FHS: restofdwelling_area cannot be negative', 'restofdwelling_area'));
    }
    if (hasLivingroomArea && hasRestOfDwellingArea) {
      const splitTotal = livingroomArea! + restOfDwellingArea!;
      if (typeof zone.floorArea === 'number' && Number.isFinite(zone.floorArea) && Math.abs(splitTotal - zone.floorArea) > 0.005) {
        issues.push(
          fhsIssue(
            `FHS: livingroom_area + restofdwelling_area (${splitTotal.toFixed(2)} m²) must equal floor area (${zone.floorArea.toFixed(2)} m²)`,
            'restofdwelling_area',
          ),
        );
      }
    }
  }

  if (zone._floorAreaUserOverride && zone._derivedFloorArea && zone._derivedFloorArea > 0) {
    const diff = Math.abs(zone.floorArea - zone._derivedFloorArea);
    if (diff > 0.005) {
      warnings.push(warn(
        `Floor area ${zone.floorArea} m² ≠ geometry ${zone._derivedFloorArea} m²`,
        'floorArea'
      ));
    }
  }

  if (zone._heightUserOverride && zone._derivedHeight && zone._derivedHeight > 0) {
    const heightDiff = Math.abs(zone.height - zone._derivedHeight);
    if (heightDiff > 0.005) {
      warnings.push(warn(
        `Height ${zone.height} m ≠ walls ${zone._derivedHeight} m`,
        'height'
      ));
    }
  }

  if (zone._groundFloorLevels && zone._groundFloorLevels.length > 1) {
    const levels = zone._groundFloorLevels.join(', ');
    warnings.push(warn(
      `Ground on multiple Z (${levels}) — area may double-count`,
      'floorArea'
    ));
  }

  if (context.elementsById) {
    const elements = Object.values(context.elementsById);
    const missingTfaZ = getZoneFloorLevelsMissingTfa(zone.id, elements);
    if (missingTfaZ.length > 0) {
      const zLabel = missingTfaZ.map((z) => `Z=${z}`).join(', ');
      warnings.push(warn(
        `${zLabel}: no treated floor — add ground or 180° floor polygon`,
        'floorArea',
      ));
    }
  }

  const hasDetailedThermalBridging = context.elementsById
    ? zoneHasDetailedThermalBridging(zone.id, context.elementsById)
    : false;
  const hasDefaultThermalBridging = hasPositiveDefaultThermalBridging(context.defaultThermalBridging);

  if (zone.simplifiedThermalBridging && hasDetailedThermalBridging) {
    warnings.push(warn(
      'Simplified ψ + detailed TB — simplified ψ wins',
      'simplifiedThermalBridging'
    ));
  }

  if (
    !context.complianceValidationEnabled
    && !zone.simplifiedThermalBridging
    && !hasDetailedThermalBridging
    && hasDefaultThermalBridging
  ) {
    warnings.push(warn(
      'Default ψ only — set zone ψ or add TB',
      'simplifiedThermalBridging'
    ));
  }

  if (
    context.complianceValidationEnabled
    && !zone.simplifiedThermalBridging
    && !hasDetailedThermalBridging
  ) {
    issues.push(fhsIssue(
      'FHS: Simplified ψ or TB elements required',
      'simplifiedThermalBridging'
    ));
  }

  return {
    hasIssues: issues.length > 0,
    issues,
    hasWarnings: warnings.length > 0,
    warnings,
  };
};

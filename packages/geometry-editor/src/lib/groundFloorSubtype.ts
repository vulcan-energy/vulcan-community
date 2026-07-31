// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export function isBasementGroundFloorType(subtype: unknown): boolean {
  return subtype === 'Heated_basement' || subtype === 'Unheated_basement';
}

export function groundFloorTypeSupportsViewerElevation(subtype: unknown): boolean {
  return !isBasementGroundFloorType(subtype);
}

export function usesGroundThermalTransmWallsAutofill(subtype?: string): boolean {
  return subtype === 'Suspended_floor' || subtype === 'Unheated_basement';
}

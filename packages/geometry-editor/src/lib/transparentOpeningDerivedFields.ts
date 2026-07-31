// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { BuildingElementTransparent, Floor } from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';
import {
  calculateDerivedBaseHeight,
  calculateDerivedWindowMidHeight,
} from './zoneDerivation';

const DERIVED_VALUE_EPSILON = 0.005;

type TransparentOpeningNumericField =
  | 'base_height'
  | 'height'
  | 'width'
  | 'free_area_height'
  | 'mid_height'
  | 'max_window_open_area';

export type TransparentOpeningNumericPatch = Partial<Record<TransparentOpeningNumericField, number>>;

export interface TransparentOpeningDerivedValues {
  midHeight: number;
  maxWindowOpenArea: number;
}

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const finiteNumberOrZero = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
);

const finiteNumberOrNull = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

const patchedNumber = (
  element: BuildingElementTransparent,
  patch: TransparentOpeningNumericPatch,
  field: TransparentOpeningNumericField,
): number => {
  if (hasOwn(patch, field)) return finiteNumberOrZero(patch[field]);
  return finiteNumberOrZero(element[field]);
};

export function calculateDerivedWindowMaxOpenArea(
  widthM: number,
  heightM: number,
  freeAreaHeightM: number,
): number {
  if (!Number.isFinite(widthM) || !Number.isFinite(heightM) || !Number.isFinite(freeAreaHeightM)) {
    return 0;
  }
  if (widthM <= 0 || freeAreaHeightM <= 0) return 0;
  const raw = widthM * freeAreaHeightM;
  const cap = heightM > 0 ? widthM * heightM : raw;
  return roundToTwoDecimals(Math.min(raw, cap));
}

function readElementStoreyForBaseHeight(element: Pick<BuildingElementTransparent, 'coordinates' | 'floorId'>): number {
  const rawZ = element.coordinates?.[0]?.z;
  if (typeof rawZ === 'number' && Number.isFinite(rawZ)) {
    return Math.floor(rawZ);
  }
  const floorId = Number.parseInt(element.floorId || '0', 10);
  return Number.isFinite(floorId) ? floorId : 0;
}

function deriveBaseHeightForMidHeight(
  element: BuildingElementTransparent,
  patch: TransparentOpeningNumericPatch,
  effectiveFloors: Floor[],
): number {
  const baseHeight = hasOwn(patch, 'base_height')
    ? finiteNumberOrZero(patch.base_height)
    : finiteNumberOrZero(element.base_height);
  if (baseHeight > 0) return baseHeight;

  const elementZ = readElementStoreyForBaseHeight(element);
  return calculateDerivedBaseHeight(elementZ, effectiveFloors);
}

function deriveWindowMidHeight(
  element: BuildingElementTransparent,
  patch: TransparentOpeningNumericPatch,
  effectiveFloors: Floor[],
): number {
  return calculateDerivedWindowMidHeight(
    deriveBaseHeightForMidHeight(element, patch, effectiveFloors),
    patchedNumber(element, patch, 'height'),
  );
}

function deriveWindowMaxOpenArea(
  element: BuildingElementTransparent,
  patch: TransparentOpeningNumericPatch,
): number {
  return calculateDerivedWindowMaxOpenArea(
    patchedNumber(element, patch, 'width'),
    patchedNumber(element, patch, 'height'),
    patchedNumber(element, patch, 'free_area_height'),
  );
}

function shouldPreserveAutomaticValue(currentValue: number | null, previousDerivedValue: number): boolean {
  return currentValue == null || currentValue <= 0 || Math.abs(currentValue - previousDerivedValue) <= DERIVED_VALUE_EPSILON;
}

export function deriveTransparentOpeningDerivedValues(
  element: BuildingElementTransparent,
  patch: TransparentOpeningNumericPatch = {},
  context: { effectiveFloors?: Floor[] } = {},
): TransparentOpeningDerivedValues {
  const effectiveFloors = context.effectiveFloors ?? [];
  return {
    midHeight: deriveWindowMidHeight(element, patch, effectiveFloors),
    maxWindowOpenArea: deriveWindowMaxOpenArea(element, patch),
  };
}

export function buildTransparentOpeningNumericPatch(
  element: BuildingElementTransparent,
  directPatch: TransparentOpeningNumericPatch,
  context: { effectiveFloors?: Floor[] } = {},
): TransparentOpeningNumericPatch {
  const patch: TransparentOpeningNumericPatch = { ...directPatch };
  const effectiveFloors = context.effectiveFloors ?? [];
  const previousDerived = deriveTransparentOpeningDerivedValues(element, {}, { effectiveFloors });
  const nextDerived = deriveTransparentOpeningDerivedValues(element, patch, { effectiveFloors });

  const midInputsChanged = hasOwn(directPatch, 'base_height') || hasOwn(directPatch, 'height');
  if (midInputsChanged && !hasOwn(directPatch, 'mid_height')) {
    const currentMidHeight = finiteNumberOrNull(element.mid_height);
    if (
      nextDerived.midHeight > 0 &&
      shouldPreserveAutomaticValue(currentMidHeight, previousDerived.midHeight) &&
      (currentMidHeight == null || Math.abs(currentMidHeight - nextDerived.midHeight) > DERIVED_VALUE_EPSILON)
    ) {
      patch.mid_height = nextDerived.midHeight;
    }
  }

  const maxOpenInputsChanged =
    hasOwn(directPatch, 'width') ||
    hasOwn(directPatch, 'height') ||
    hasOwn(directPatch, 'free_area_height');
  if (maxOpenInputsChanged && !hasOwn(directPatch, 'max_window_open_area')) {
    const currentMaxOpenArea = finiteNumberOrNull(element.max_window_open_area);
    if (
      shouldPreserveAutomaticValue(currentMaxOpenArea, previousDerived.maxWindowOpenArea) &&
      (currentMaxOpenArea == null || Math.abs(currentMaxOpenArea - nextDerived.maxWindowOpenArea) > DERIVED_VALUE_EPSILON)
    ) {
      patch.max_window_open_area = nextDerived.maxWindowOpenArea;
    }
  }

  return patch;
}

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';

type LightingField = 'efficacy' | 'count' | 'power';

export type NumericBulkFieldDescriptor = {
  fieldKey: string;
  modelField: string;
  label: string;
  isEligible: (element: Element) => boolean;
  readValue: (element: Element) => number | undefined;
  buildPatch: (element: Element, value: number) => Partial<Element>;
};

export type BulkFieldDistribution = {
  eligibleIds: string[];
  entries: Array<{ value: number | undefined; count: number }>;
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extraJsonRecord(element: Element): Record<string, unknown> {
  const value = element.extra_json;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getLightingFieldValue(element: Element, field: LightingField): number | undefined {
  const direct = finiteNumber((element as unknown as Record<string, unknown>)[field]);
  if (direct !== undefined) return direct;

  const bulbs = (element as {
    bulbs?: Record<string, { efficacy?: number; count?: number; power?: number }>;
  }).bulbs;
  if (!bulbs || typeof bulbs !== 'object') return undefined;
  return finiteNumber((bulbs.led ?? bulbs.incandescent)?.[field]);
}

export function buildLightingFieldPatch(
  element: Element,
  overrides: Record<string, unknown>,
  options: { markDetailed?: boolean; keepOnlyPositive?: boolean } = {},
): Partial<Element> {
  const resolve = (field: LightingField) =>
    Object.prototype.hasOwnProperty.call(overrides, field)
      ? finiteNumber(overrides[field])
      : getLightingFieldValue(element, field);
  const normalize = (value: number | undefined) =>
    options.keepOnlyPositive && !(typeof value === 'number' && value > 0) ? undefined : value;
  const efficacy = normalize(resolve('efficacy'));
  const count = normalize(resolve('count'));
  const power = normalize(resolve('power'));
  const patch: Partial<Element> = {
    ...overrides,
    efficacy,
    count,
    power,
    bulbs: { led: { efficacy, count, power } },
  } as Partial<Element>;

  if (options.markDetailed) {
    patch.extra_json = {
      ...extraJsonRecord(element),
      _lighting_entry_mode: 'detailed',
    };
  }
  return patch;
}

const isLighting = (element: Element) => element.type === 'Lighting';
const isThermalBridgePoint = (element: Element) => element.type === 'ThermalBridgePoint';

export const LIGHTING_BULK_FIELD_DESCRIPTORS = {
  efficacy: {
    fieldKey: 'lightingEfficacy',
    modelField: 'efficacy',
    label: 'Efficacy',
    isEligible: isLighting,
    readValue: (element) => getLightingFieldValue(element, 'efficacy'),
    buildPatch: (element, value) => buildLightingFieldPatch(element, { efficacy: value }, { markDetailed: true }),
  },
  count: {
    fieldKey: 'lightingCount',
    modelField: 'count',
    label: 'Count',
    isEligible: isLighting,
    readValue: (element) => getLightingFieldValue(element, 'count'),
    buildPatch: (element, value) => buildLightingFieldPatch(element, { count: value }),
  },
  power: {
    fieldKey: 'lightingPower',
    modelField: 'power',
    label: 'Power (W)',
    isEligible: isLighting,
    readValue: (element) => getLightingFieldValue(element, 'power'),
    buildPatch: (element, value) => buildLightingFieldPatch(element, { power: value }, { markDetailed: true }),
  },
} satisfies Record<LightingField, NumericBulkFieldDescriptor>;

export const THERMAL_BRIDGE_POINT_BULK_FIELD_DESCRIPTORS = {
  heatTransferCoeff: {
    fieldKey: 'heatTransferCoeff',
    modelField: 'heat_transfer_coeff',
    label: 'Heat Transfer Coefficient',
    isEligible: isThermalBridgePoint,
    readValue: (element) =>
      element.type === 'ThermalBridgePoint' ? finiteNumber(element.heat_transfer_coeff) : undefined,
    buildPatch: (_element, value) => ({ heat_transfer_coeff: value } as Partial<Element>),
  },
} satisfies Record<'heatTransferCoeff', NumericBulkFieldDescriptor>;

export function describeBulkFieldDistribution(
  elements: readonly Element[],
  descriptor: NumericBulkFieldDescriptor,
): BulkFieldDistribution {
  const eligible = elements.filter(descriptor.isEligible);
  const counts = new Map<number | undefined, number>();
  for (const element of eligible) {
    const value = descriptor.readValue(element);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return {
    eligibleIds: eligible.map((element) => element.id),
    entries: Array.from(counts, ([value, count]) => ({ value, count })),
  };
}

export function buildBulkFieldPatches(
  elements: readonly Element[],
  descriptor: NumericBulkFieldDescriptor,
  value: number,
): Record<string, Partial<Element>> {
  return Object.fromEntries(
    elements
      .filter(descriptor.isEligible)
      .map((element) => [element.id, descriptor.buildPatch(element, value)]),
  );
}

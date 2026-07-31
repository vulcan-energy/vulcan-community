// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor } from '../geometry/types';

export function windowSecurityRiskDefaultForStorey(storey: number | undefined): boolean {
  return storey === 0;
}

export function resolveElementStorey(
  element: Pick<Element, 'coordinates' | 'floorId'>,
  floors: Pick<Floor, 'id' | 'zIndex'>[] = [],
): number | undefined {
  const z = element.coordinates?.[0]?.z;
  if (typeof z === 'number' && Number.isFinite(z)) {
    return Math.floor(z);
  }

  const floorId = typeof element.floorId === 'string' ? element.floorId.trim() : '';
  if (!floorId) return undefined;

  const floor = floors.find((f) => f.id === floorId);
  if (floor) return floor.zIndex;

  const numeric = Number(floorId);
  return Number.isFinite(numeric) ? Math.floor(numeric) : undefined;
}

function readExtraJson(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function windowSecurityRiskDefaultForElement(
  element: Pick<Element, 'coordinates' | 'floorId'> | undefined,
  floors: Pick<Floor, 'id' | 'zIndex'>[] = [],
): boolean {
  return windowSecurityRiskDefaultForStorey(element ? resolveElementStorey(element, floors) : undefined);
}

export function syncWindowSecurityRiskForStorey(
  nextElement: Element,
  previousElement: Element | undefined,
  floors: Pick<Floor, 'id' | 'zIndex'>[] = [],
): Element {
  if (nextElement.type !== 'BuildingElementTransparent') return nextElement;

  const nextStorey = resolveElementStorey(nextElement, floors);
  const nextDefault = windowSecurityRiskDefaultForStorey(nextStorey);
  const nextExtra = readExtraJson(nextElement.extra_json);
  const hasNextValue = Object.prototype.hasOwnProperty.call(nextExtra, 'security_risk');

  if (!previousElement || previousElement.type !== 'BuildingElementTransparent') {
    if (hasNextValue) return nextElement;
    return {
      ...nextElement,
      extra_json: { ...nextExtra, security_risk: nextDefault },
    };
  }

  const prevStorey = resolveElementStorey(previousElement, floors);
  const prevDefault = windowSecurityRiskDefaultForStorey(prevStorey);
  const prevExtra = readExtraJson(previousElement.extra_json);
  const prevValue = prevExtra.security_risk;

  if (hasNextValue && nextExtra.security_risk !== prevValue) {
    return nextElement;
  }

  const prevValueWasAuto =
    !Object.prototype.hasOwnProperty.call(prevExtra, 'security_risk') ||
    prevValue === prevDefault;

  if (!prevValueWasAuto) return nextElement;

  return {
    ...nextElement,
    extra_json: { ...nextExtra, security_risk: nextDefault },
  };
}

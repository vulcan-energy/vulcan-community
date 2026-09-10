// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor } from '../geometry/types';
import { WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR } from './overrideProvenance';

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

function withAutomaticSecurityRisk(
  element: Element,
  extraJson: Record<string, unknown>,
  value: boolean,
): Element {
  return {
    ...element,
    extra_json: { ...extraJson, security_risk: value },
  };
}

function withManualSecurityRisk(
  element: Element,
  extraJson: Record<string, unknown>,
): Element {
  return {
    ...element,
    _windowSecurityRiskUserOverride: WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.positiveSense,
    extra_json: extraJson,
  };
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
  const nextOverride = nextElement[WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.flag];
  const nextMarker = nextExtra[WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.key] === WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.positiveSense;

  // A typed false flag is an explicit reset-to-auto. A legacy/persisted positive marker remains
  // authoritative only while the typed flag is absent; this lets a reset remove a stale marker
  // on the next export without allowing it to re-enable the override in-session.
  if (nextOverride === WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.positiveSense || (nextOverride === undefined && nextMarker)) {
    return nextElement;
  }

  if (!previousElement || previousElement.type !== 'BuildingElementTransparent') {
    if (hasNextValue && nextOverride !== false) return withManualSecurityRisk(nextElement, nextExtra);
    return withAutomaticSecurityRisk(nextElement, nextExtra, nextDefault);
  }

  const prevStorey = resolveElementStorey(previousElement, floors);
  const prevDefault = windowSecurityRiskDefaultForStorey(prevStorey);
  const prevExtra = readExtraJson(previousElement.extra_json);
  const prevValue = prevExtra.security_risk;

  if (nextOverride === false) {
    return withAutomaticSecurityRisk(nextElement, nextExtra, nextDefault);
  }

  if (hasNextValue && nextExtra.security_risk !== prevValue) {
    return withManualSecurityRisk(nextElement, nextExtra);
  }

  const previousOverride =
    previousElement[WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.flag];
  if (previousOverride === WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.positiveSense) return nextElement;
  if (previousOverride === false) return withAutomaticSecurityRisk(nextElement, nextExtra, nextDefault);

  const prevValueWasAuto =
    !Object.prototype.hasOwnProperty.call(prevExtra, 'security_risk') ||
    prevValue === prevDefault;

  if (!prevValueWasAuto) return withManualSecurityRisk(nextElement, nextExtra);

  return withAutomaticSecurityRisk(nextElement, nextExtra, nextDefault);
}

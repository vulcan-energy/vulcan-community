// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR } from '../overrideProvenance';
import { syncWindowSecurityRiskForStorey } from '../windowSecurityRisk';

const floors = [
  { id: 'ground', zIndex: 0 },
  { id: 'first', zIndex: 1 },
];

type WindowWithSecurityOverride = Element & {
  _windowSecurityRiskUserOverride?: boolean;
};

function windowAt(
  z: number,
  floorId: string,
  extra_json?: Record<string, unknown>,
  override?: boolean,
): WindowWithSecurityOverride {
  return {
    id: 'window',
    name: 'Window',
    type: 'BuildingElementTransparent',
    parent_element: null,
    floorId,
    coordinates: [{ x: 0, y: 0, z }, { x: 1, y: 0, z }],
    ...(extra_json === undefined ? {} : { extra_json }),
    ...(override === undefined
      ? {}
      : { [WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.flag]: override }),
  } as WindowWithSecurityOverride;
}

describe('window security risk provenance', () => {
  it.each([false, true])('preserves an explicit value through a floor round-trip (%s)', (value) => {
    const initial = syncWindowSecurityRiskForStorey(
      windowAt(0, 'ground', { security_risk: value }),
      undefined,
      floors,
    );
    const first = syncWindowSecurityRiskForStorey(
      windowAt(1, 'first', initial.extra_json, initial[WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.flag]),
      initial,
      floors,
    );
    const ground = syncWindowSecurityRiskForStorey(
      windowAt(0, 'ground', first.extra_json, first[WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.flag]),
      first,
      floors,
    );

    expect(initial.extra_json?.security_risk).toBe(value);
    expect(initial[WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.flag]).toBe(true);
    expect(first.extra_json?.security_risk).toBe(value);
    expect(ground.extra_json?.security_risk).toBe(value);
  });

  it('promotes a legacy divergent value to provenance on its first move', () => {
    const legacyGround = windowAt(0, 'ground', { security_risk: false });
    const first = syncWindowSecurityRiskForStorey(
      windowAt(1, 'first', legacyGround.extra_json),
      legacyGround,
      floors,
    );

    expect(first.extra_json?.security_risk).toBe(false);
    expect(first[WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.flag]).toBe(true);
  });

  it('honours an explicit reset-to-auto flag', () => {
    const manualGround = windowAt(0, 'ground', { security_risk: false }, true);
    const resetFirst = syncWindowSecurityRiskForStorey(
      windowAt(1, 'first', { security_risk: false }, false),
      manualGround,
      floors,
    );
    const automaticGround = syncWindowSecurityRiskForStorey(
      windowAt(0, 'ground', resetFirst.extra_json, false),
      resetFirst,
      floors,
    );

    expect(resetFirst.extra_json?.security_risk).toBe(false);
    expect(resetFirst[WINDOW_SECURITY_RISK_OVERRIDE_DESCRIPTOR.flag]).toBe(false);
    expect(automaticGround.extra_json?.security_risk).toBe(true);
  });
});

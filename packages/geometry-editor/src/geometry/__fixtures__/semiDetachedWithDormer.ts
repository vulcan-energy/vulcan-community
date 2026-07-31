// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildDormerBundleDraft } from '../../lib/dormerGeometry';
import { parseCsvToGeometry } from '../io/parseCsvToGeometry';
import type { BuildingElementOpaque, Element, Floor } from '../types';

// The two-storey semi-detached model this editor ships as its sample project, byte for
// byte. Keeping it identical rather than editing a copy means the fixture is provably the
// example a user actually opens, and every deviation from it is visible in code below.
const BASE_CSV_PATH = resolve(import.meta.dirname, 'example_semi_detached.csv');

// Build the dormer with the same function the canvas calls rather than hand-authoring
// coordinates, cut-out polygons and bundle metadata. This keeps the fixture aligned with
// geometry the editor can produce.
const HOST_ROOF_NAME = 'Pitched Roof (S)';

export interface SemiDetachedWithDormer {
  elements: Element[];
  floors: Floor[];
  hostRoofName: string;
  dormerNames: {
    frontWall: string;
    leftCheek: string;
    rightCheek: string;
    roofs: string[];
    window: string;
  };
}

export function parseSemiDetachedSample() {
  return parseCsvToGeometry(readFileSync(BASE_CSV_PATH, 'utf-8'));
}

/**
 * The sample with a mono-pitch dormer on its south pitched roof.
 *
 * The host is marked as a warm roof here. The sample ships it as an unheated pitched roof,
 * which is a cold roof over a two-storey house; a dormer is a room-in-roof feature, and the
 * junctions under test are the ones between heated dormer fabric and its host. Nothing in
 * the dormer builder reads the flag — this is about the scenario being coherent, not about
 * making the geometry work.
 */
export function buildSemiDetachedWithDormer(): SemiDetachedWithDormer {
  const parsed = parseSemiDetachedSample();
  const elements = (parsed.elements as Element[]).map((element) =>
    element.name === HOST_ROOF_NAME
      ? { ...element, is_unheated_pitched_roof: false }
      : element,
  );
  const floors = (parsed as { floors?: Floor[] }).floors ?? [];

  const host = elements.find(
    (element): element is BuildingElementOpaque => element.name === HOST_ROOF_NAME,
  );
  if (!host) throw new Error(`${HOST_ROOF_NAME} is missing from the sample model`);

  // The centre of the host's plan footprint, so the dormer sits on the roof rather than
  // clipping an edge, and its position is derived rather than a magic coordinate.
  const plan = host.coordinates ?? [];
  const windowCenterPlanPoint = {
    x: plan.reduce((total, point) => total + point.x, 0) / plan.length,
    y: plan.reduce((total, point) => total + point.y, 0) / plan.length,
  };

  const draft = buildDormerBundleDraft({
    host,
    dormerType: 'gable-front',
    windowCenterPlanPoint,
    existingNames: elements.map((element) => element.name),
    floors,
    globalOrientationOffset: 0,
  });
  if (!draft) throw new Error('the dormer builder rejected the sample host roof');

  // Committed the way GeometryCanvas commits one: a member per element, parented as the
  // draft says. Ids only have to be unique within the fixture.
  const withDormer: Element[] = [...elements];
  draft.members.forEach((member, index) => {
    withDormer.push({
      id: `dormer-${index}`,
      name: member.name,
      zoneId: host.zoneId,
      type: member.type,
      parent_element: member.parent ?? undefined,
      ...member.updates,
    } as unknown as Element);
  });

  return {
    elements: withDormer,
    floors,
    hostRoofName: HOST_ROOF_NAME,
    dormerNames: {
      frontWall: draft.names.frontWall,
      leftCheek: draft.names.leftCheekWall,
      rightCheek: draft.names.rightCheekWall,
      roofs: [...draft.names.roofs],
      window: draft.names.window,
    },
  };
}

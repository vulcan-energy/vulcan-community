// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque } from '../../geometry/types';
import { getElementEffectiveArea, getElementGrossArea, getOpaqueElementExportGeometry } from '../elementArea';
import { calculateDirectionArrow } from '../directionArrows';
import { orientation360SlopedFromFirstEdge } from '../openingSegmentOutward';
import type { Element } from '../../geometry/types';
import {
  buildDormerBundleDraft as buildDormerBundleDraftActual,
  buildDormerCutoutPolygon,
  computeAutoDormerBundleName,
  deriveDormerHostBasis,
  isDormerBundleNameManual,
  looksLikeAutoDormerBundleName,
  getDormerBundleAnchorElement,
  getDormerBundleElementIds,
  getDormerBundleMetadata,
  getDormerBundleName,
  getDormerCutoutProjectedArea,
  getDormerCutoutSurfaceArea,
  getDormerPlacementDefaults,
  getDormerHostBaseElevationM,
  isValidDormerHost,
  resolveDormerGeometry,
} from '../dormerGeometry';

type BuildDormerBundleDraftParams = Parameters<typeof buildDormerBundleDraftActual>[0];

const buildDormerBundleDraft = (
  params: Omit<BuildDormerBundleDraftParams, 'globalOrientationOffset'> &
    Partial<Pick<BuildDormerBundleDraftParams, 'globalOrientationOffset'>>,
) => buildDormerBundleDraftActual({ globalOrientationOffset: 0, ...params });

function rotatePoint(
  point: { x: number; y: number; z: number },
  center: { x: number; y: number },
  angleDeg: number,
) {
  const angleRad = (angleDeg * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * Math.cos(angleRad)) - (dy * Math.sin(angleRad)),
    y: center.y + (dx * Math.sin(angleRad)) + (dy * Math.cos(angleRad)),
    z: point.z,
  };
}

function makeHostRoof(overrides: Partial<BuildingElementOpaque> = {}): BuildingElementOpaque {
  return {
    id: 'roof-1',
    name: 'MainRoof',
    zoneId: 'zone-1',
    type: 'BuildingElementOpaque',
    parent_element: null,
    width: 4,
    height: 3,
    area: 12,
    pitch: 35,
    orientation360: 180,
    base_height: 2.4,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 3, z: 0 },
      { x: 0, y: 3, z: 0 },
    ],
    ...overrides,
  };
}

function makeRotatedHostRoof(angleDeg: number): BuildingElementOpaque {
  const base = makeHostRoof();
  const center = { x: 2, y: 1.5 };
  const coordinates = base.coordinates.map((point) => rotatePoint(point, center, angleDeg));
  const rotatedWindowCenter = rotatePoint({ x: 2, y: 1, z: 0 }, center, angleDeg);

  return {
    ...base,
    coordinates,
    extra_json: {
      testWindowCenter: {
        x: rotatedWindowCenter.x,
        y: rotatedWindowCenter.y,
      },
    },
  };
}

const ROTATED_HOST_ANGLES = [0, 45, 90, 180, 225, 315] as const;

function getDormerInteriorPoint(host: BuildingElementOpaque, depth: number) {
  const basis = deriveDormerHostBasis(host);
  const windowCenter = (host.extra_json as any)?.testWindowCenter as { x: number; y: number } | undefined;
  if (!basis || !windowCenter) {
    throw new Error('Expected dormer host basis and test window center');
  }

  return {
    x: windowCenter.x + basis.vAxis[0] * (depth / 2),
    y: windowCenter.y + basis.vAxis[1] * (depth / 2),
  };
}

function expectArrowAwayFromInterior(
  coordinates: Array<{ x: number; y: number; z: number }>,
  interiorPoint: { x: number; y: number },
) {
  const arrow = calculateDirectionArrow({
    type: 'BuildingElementOpaque',
    coordinates,
    orientation360: 0,
  } as any);

  expect(arrow).not.toBeNull();
  const arrowVectorX = (arrow?.arrowX ?? 0) - (arrow?.centerX ?? 0);
  const arrowVectorY = (arrow?.arrowY ?? 0) - (arrow?.centerY ?? 0);
  const toInteriorX = interiorPoint.x - (arrow?.centerX ?? 0);
  const toInteriorY = interiorPoint.y - (arrow?.centerY ?? 0);

  expect((arrowVectorX * toInteriorX) + (arrowVectorY * toInteriorY)).toBeLessThanOrEqual(1e-6);
}

function getArrowVector(
  coordinates: Array<{ x: number; y: number; z: number }>,
): { x: number; y: number } {
  const arrow = calculateDirectionArrow({
    type: 'BuildingElementOpaque',
    coordinates,
    orientation360: 0,
  } as any);

  expect(arrow).not.toBeNull();
  return {
    x: (arrow?.arrowX ?? 0) - (arrow?.centerX ?? 0),
    y: (arrow?.arrowY ?? 0) - (arrow?.centerY ?? 0),
  };
}

function expectArrowsAligned(
  leftCoordinates: Array<{ x: number; y: number; z: number }>,
  rightCoordinates: Array<{ x: number; y: number; z: number }>,
) {
  const left = getArrowVector(leftCoordinates);
  const right = getArrowVector(rightCoordinates);
  expect((left.x * right.x) + (left.y * right.y)).toBeGreaterThan(0);
}

function expectOrientationMatchesLeadEdgeOutwardNormal(
  element: { coordinates?: Array<{ x: number; y: number; z: number }>; orientation360?: number },
  globalOrientationOffset = 0,
) {
  const coords = element.coordinates ?? [];
  expect(coords.length).toBeGreaterThanOrEqual(2);
  const expected = orientation360SlopedFromFirstEdge(
    coords[0].x,
    coords[0].y,
    coords[1].x,
    coords[1].y,
    globalOrientationOffset,
  );
  expect(element.orientation360).toBeCloseTo(expected ?? 0, 6);
}

function pointKey(point: { x: number; y: number; z: number }) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z.toFixed(3)}`;
}

function expectLeadEdgeMatchesSegment(
  polygon: Array<{ x: number; y: number; z: number }>,
  segment: Array<{ x: number; y: number; z: number }>,
) {
  expect(polygon.length).toBeGreaterThanOrEqual(2);
  expect(segment.length).toBe(2);
  expect([pointKey(polygon[0]), pointKey(polygon[1])].sort()).toEqual(
    [pointKey(segment[0]), pointKey(segment[1])].sort(),
  );
}

function expectPointSetEqual(
  actual: Array<{ x: number; y: number; z: number }>,
  expected: Array<{ x: number; y: number; z: number }>,
) {
  expect(actual.map(pointKey).sort()).toEqual(expected.map(pointKey).sort());
}

describe('dormerGeometry', () => {
  it('applies global orientation offset to mono-pitch dormer roof orientation360', () => {
    const draft = buildDormerBundleDraft({
      host: makeHostRoof(),
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
      globalOrientationOffset: 33,
    });
    expect(draft).not.toBeNull();
    expectOrientationMatchesLeadEdgeOutwardNormal(draft!.roof, 33);
  });

  it('returns the expected placement defaults', () => {
    expect(getDormerPlacementDefaults()).toEqual({
      dormerWidth: 2.0,
      dormerDepth: 1.5,
      frontWallHeight: 1.2,
      dormerRoofPitch: 15,
      gableRoofPitch: 35,
      isUnheatedPitchedRoof: false,
      windowWidth: 1.2,
      windowHeight: 1.0,
      windowSillHeight: 0.6,
      frameAreaFraction: 0.25,
    });
  });

  it('accepts a sloped opaque polygon as a valid dormer host', () => {
    expect(isValidDormerHost(makeHostRoof())).toBe(true);
  });

  it('rejects line-based opaque elements as dormer hosts', () => {
    expect(
      isValidDormerHost(
        makeHostRoof({
          coordinates: [
            { x: 0, y: 0, z: 0 },
            { x: 4, y: 0, z: 0 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('rejects flat or vertical opaque elements as dormer hosts', () => {
    expect(isValidDormerHost(makeHostRoof({ pitch: 0 }))).toBe(false);
    expect(isValidDormerHost(makeHostRoof({ pitch: 90 }))).toBe(false);
  });

  it('rejects an Orientation pitch-axis sloped roof', () => {
    expect(isValidDormerHost(makeHostRoof({
      extra_json: { _slope_pitch_axis: 'orientation' },
      orientation360: 180,
    }))).toBe(false);
  });

  it('derives host basis from the eaves edge and polygon interior', () => {
    const basis = deriveDormerHostBasis(makeHostRoof());
    expect(basis).not.toBeNull();
    expect(basis?.uAxis[0]).toBeCloseTo(1, 6);
    expect(basis?.uAxis[1]).toBeCloseTo(0, 6);
    expect(basis?.vAxis[0]).toBeCloseTo(0, 6);
    expect(basis?.vAxis[1]).toBeCloseTo(1, 6);
  });

  it('builds a rectangular cutout polygon centered on the clicked window point', () => {
    const polygon = buildDormerCutoutPolygon(makeHostRoof(), {
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
      dormerWidth: 2,
      dormerDepth: 1.5,
    });

    expect(polygon).toEqual([
      { x: 1, y: 1, z: 0 },
      { x: 3, y: 1, z: 0 },
      { x: 3, y: 2.5, z: 0 },
      { x: 1, y: 2.5, z: 0 },
    ]);
  });

  it('calculates projected cutout area from the generated polygon', () => {
    const polygon = buildDormerCutoutPolygon(makeHostRoof(), {
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
      dormerWidth: 2,
      dormerDepth: 1.5,
    });

    expect(polygon).not.toBeNull();
    expect(getDormerCutoutProjectedArea(polygon ?? [])).toBeCloseTo(3, 6);
  });

  it('calculates true sloped cutout area from the generated polygon', () => {
    const host = makeHostRoof();
    const polygon = buildDormerCutoutPolygon(host, {
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
      dormerWidth: 2,
      dormerDepth: 1.5,
    });

    expect(polygon).not.toBeNull();
    expect(getDormerCutoutSurfaceArea(host, polygon ?? [])).toBeCloseTo(3.66, 2);
  });

  it('builds a default dormer bundle draft with stable child relationships', () => {
    const draft = buildDormerBundleDraft({
      host: makeHostRoof(),
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
      existingNames: ['MainRoof Dormer Front Wall'],
      existingBundleNames: ['MainRoof Dormer 1'],
      placementDefaults: {
        isUnheatedPitchedRoof: true,
      },
    });

    expect(draft).not.toBeNull();
    expect(draft?.bundleName).toBe('MainRoof Dormer 2');
    expect(draft?.names.frontWall).toBe('MainRoof Dormer Front Wall 2');
    expect(draft?.frontWall.coordinates).toEqual([
      { x: 1, y: 1, z: 0 },
      { x: 3, y: 1, z: 0 },
    ]);
    expect(draft?.leftCheekWall.coordinates).toEqual([
      { x: 1, y: 3, z: 0 },
      { x: 1, y: 1, z: 0 },
    ]);
    expect(draft?.rightCheekWall.coordinates).toEqual([
      { x: 3, y: 1, z: 0 },
      { x: 3, y: 3, z: 0 },
    ]);
    expect(draft?.window.coordinates).toEqual([
      { x: 1.4, y: 1, z: 0 },
      { x: 2.6, y: 1, z: 0 },
    ]);
    expect(draft?.frontWall.extra_json?.parent_netting_area).toBeCloseTo(4.88, 2);
    expect((draft?.frontWall.extra_json?.dormer_bundle as any)?.host_cutout_projected_area).toBeCloseTo(4, 6);
    expect((draft?.frontWall.extra_json?.dormer_bundle as any)?.host_cutout_surface_area).toBeCloseTo(4.88, 2);
    expect(draft?.frontWall.base_height).toBeCloseTo(3.1, 1);
    expect(draft?.roof.base_height).toBeCloseTo(3.96, 2);
    expect(draft?.window.base_height).toBeCloseTo(3.15, 2);
    expect(draft?.window.height).toBeCloseTo(0.665, 2);
    expect(draft?.frontWall.width).toBeCloseTo(2, 6);
    expect(draft?.frontWall.area).toBeCloseTo(1.73, 2);
    expect(draft?.roof.width).toBeCloseTo(2, 6);
    expect(draft?.roof.height).toBeCloseTo(2.07, 2);
    expect(draft?.roof.area).toBeCloseTo(4.14, 2);
    expect(draft?.roof.is_unheated_pitched_roof).toBe(true);
    expect(draft?.window.width).toBeCloseTo(1.2, 6);
    expect(draft?.window.area).toBeCloseTo(0.798, 2);
    expect(draft?.window.max_window_open_area).toBeCloseTo(draft?.window.area ?? 0, 6);
    expect(draft?.leftCheekWall.extra_json?.geometry_face).toMatchObject({
      kind: 'planar-face-3d',
    });
    const cheekFace = draft?.leftCheekWall.extra_json?.geometry_face as {
      kind?: string;
      points?: Array<{ x: number; y: number; z: number }>;
    } | undefined;
    expect(cheekFace?.points).toHaveLength(3);
    expectPointSetEqual(cheekFace?.points ?? [], [
      { x: 1, y: 3, z: 4.501 },
      { x: 1, y: 1, z: 3.1 },
      { x: 1, y: 1, z: 3.965 },
    ]);
    expect(getDormerBundleMetadata({ ...makeHostRoof(), extra_json: draft?.frontWall.extra_json } as any)?.dormerWidth).toBe(2);
    expect(getDormerBundleMetadata({ ...makeHostRoof(), extra_json: draft?.frontWall.extra_json } as any)?.dormerDepth).toBeCloseTo(2, 2);
    expect(getDormerBundleMetadata({ ...makeHostRoof(), extra_json: draft?.frontWall.extra_json } as any)?.dormerRoofPitch).toBeCloseTo(15, 2);
    expect(getDormerBundleMetadata({ ...makeHostRoof(), extra_json: draft?.frontWall.extra_json } as any)?.isUnheatedPitchedRoof).toBe(true);
    expect(getDormerBundleMetadata({ ...makeHostRoof(), extra_json: draft?.frontWall.extra_json } as any)?.bundle_name).toBe('MainRoof Dormer 2');
  });

  it('falls back to the anchor name when older dormer metadata has no bundle name', () => {
    const draft = buildDormerBundleDraft({
      host: makeHostRoof(),
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
      bundleName: 'MainRoof Dormer 1',
    });

    const legacyAnchor = {
      ...makeHostRoof(),
      name: draft?.names.frontWall ?? 'MainRoof Dormer Front Wall',
      extra_json: {
        dormer_bundle: {
          ...(draft?.frontWall.extra_json?.dormer_bundle as Record<string, unknown>),
        },
      },
    } as any;
    delete legacyAnchor.extra_json.dormer_bundle.bundle_name;

    expect(getDormerBundleName(legacyAnchor)).toBe(legacyAnchor.name);
    expect(getDormerBundleMetadata(legacyAnchor)?.bundle_name).toBe(legacyAnchor.name);
  });

  it('finds dormer bundle members and the front-wall anchor from shared metadata', () => {
    const draft = buildDormerBundleDraft({
      host: makeHostRoof(),
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
      bundleName: 'MainRoof Dormer 1',
      bundleId: 'bundle-1',
    });

    const elementsById = {
      anchor: {
        ...makeHostRoof(),
        id: 'anchor',
        name: draft?.names.frontWall ?? 'Front Wall',
        extra_json: draft?.frontWall.extra_json,
      },
      left: {
        ...makeHostRoof(),
        id: 'left',
        name: draft?.names.leftCheekWall ?? 'Left Cheek',
        extra_json: draft?.leftCheekWall.extra_json,
      },
      right: {
        ...makeHostRoof(),
        id: 'right',
        name: draft?.names.rightCheekWall ?? 'Right Cheek',
        extra_json: draft?.rightCheekWall.extra_json,
      },
      roof: {
        ...makeHostRoof(),
        id: 'roof',
        name: draft?.names.roof ?? 'Roof',
        extra_json: draft?.roof.extra_json,
      },
      window: {
        ...makeHostRoof(),
        id: 'window',
        type: 'BuildingElementTransparent',
        name: draft?.names.window ?? 'Window',
        extra_json: draft?.window.extra_json,
      },
    } as any;

    expect(getDormerBundleElementIds(elementsById, 'bundle-1').sort()).toEqual([
      'anchor',
      'left',
      'right',
      'roof',
      'window',
    ]);
    expect(getDormerBundleAnchorElement(elementsById, 'bundle-1')?.id).toBe('anchor');
  });

  it('solves mono-pitch dormers so the rear roof edge lands back on the host roof plane', () => {
    const resolved = resolveDormerGeometry({
      host: makeHostRoof(),
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.dormerDepth).toBeCloseTo(2, 2);
    expect(resolved?.frontWallHeight).toBeCloseTo(0.865, 2);
    expect(resolved?.roofFrontBaseHeight).toBeCloseTo(3.96, 2);
    expect(resolved?.rearBaseHeight).toBeCloseTo(4.5, 2);
    expect(resolved?.dormerRoofPitch).toBeCloseTo(15, 2);
    expect(resolved?.backIntersectionLeft.elevation).toBeCloseTo(resolved?.rearBaseHeight ?? 0, 6);
  });

  it('constrains the dormer window so it always stays inside the resolved front wall', () => {
    const resolved = resolveDormerGeometry({
      host: makeHostRoof(),
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
      placementDefaults: {
        windowHeight: 2,
        windowSillHeight: 0.8,
      },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.windowHeight).toBeCloseTo(0.665, 2);
    expect(resolved?.windowSillHeight).toBeCloseTo(0.05, 2);
    expect((resolved?.windowSillHeight ?? 0) + (resolved?.windowHeight ?? 0)).toBeLessThanOrEqual(
      (resolved?.frontWallHeight ?? 0) - 0.15 + 1e-6,
    );
  });

  it('uses the dormer parent netting override on the host roof effective area', () => {
    const host = makeHostRoof();
    const draft = buildDormerBundleDraft({
      host,
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
    });

    expect(draft).not.toBeNull();

    const anchorFrontWall: BuildingElementOpaque = {
      id: 'dormer-front-wall',
      name: draft?.names.frontWall ?? 'Dormer Front Wall',
      zoneId: host.zoneId,
      type: 'BuildingElementOpaque',
      parent_element: host.name,
      width: 2,
      height: 1.2,
      area: 2.4,
      coordinates: draft?.frontWall.coordinates ?? [],
      pitch: 90,
      extra_json: draft?.frontWall.extra_json,
    };

    expect(getElementGrossArea(host)).toBeCloseTo(14.65, 2);
    expect(
      getElementEffectiveArea(host, {
        [host.id]: host,
        [anchorFrontWall.id]: anchorFrontWall,
      }),
    ).toBeCloseTo(9.77, 2);
  });

  it('falls back to sloped dormer cutout metadata for older projected netting overrides', () => {
    const host = makeHostRoof();
    const draft = buildDormerBundleDraft({
      host,
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
    });

    const legacyDormerBundle = {
      ...((draft?.frontWall.extra_json?.dormer_bundle as Record<string, unknown>) ?? {}),
    };
    delete legacyDormerBundle.host_cutout_surface_area;

    const anchorFrontWall: BuildingElementOpaque = {
      id: 'legacy-dormer-front-wall',
      name: draft?.names.frontWall ?? 'Dormer Front Wall',
      zoneId: host.zoneId,
      type: 'BuildingElementOpaque',
      parent_element: host.name,
      width: 2,
      height: 1.2,
      area: 2.4,
      coordinates: draft?.frontWall.coordinates ?? [],
      pitch: 90,
      extra_json: {
        dormer_bundle: legacyDormerBundle,
        parent_netting_area: 4,
      },
    };

    expect(
      getElementEffectiveArea(host, {
        [host.id]: host,
        [anchorFrontWall.id]: anchorFrontWall,
      }),
    ).toBeCloseTo(9.77, 2);
  });

  it('exports explicit dormer cheek faces with true area and equivalent rectangle dimensions', () => {
    const draft = buildDormerBundleDraft({
      host: makeHostRoof(),
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
    });

    expect(draft).not.toBeNull();

    const cheekWall: BuildingElementOpaque = {
      id: 'left-cheek-wall',
      name: draft?.names.leftCheekWall ?? 'Left Cheek',
      zoneId: 'zone-1',
      type: 'BuildingElementOpaque',
      parent_element: draft?.names.frontWall ?? null,
      coordinates: draft?.leftCheekWall.coordinates ?? [],
      width: draft?.leftCheekWall.width ?? 0,
      height: draft?.leftCheekWall.height ?? 0,
      area: draft?.leftCheekWall.area ?? 0,
      pitch: 90,
      base_height: draft?.leftCheekWall.base_height,
      extra_json: draft?.leftCheekWall.extra_json,
    };

    expect(getElementGrossArea(cheekWall)).toBeCloseTo(0.87, 2);
    expect(getOpaqueElementExportGeometry(cheekWall)).toEqual({
      width: 2,
      height: 0.87,
      baseHeight: 3.1,
    });
  });

  it('builds gable-front dormers with a profiled front wall and two roof members', () => {
    const host = makeHostRoof();
    const windowCenterPlanPoint = { x: 2, y: 1 };
    const draft = buildDormerBundleDraft({
      host,
      dormerType: 'gable-front',
      windowCenterPlanPoint,
    });
    const resolved = resolveDormerGeometry({
      host,
      dormerType: 'gable-front',
      windowCenterPlanPoint,
    });

    expect(draft).not.toBeNull();
    expect(resolved).not.toBeNull();
    expect(draft?.names.roofs).toHaveLength(2);
    expect(draft?.roofs.map((roof) => roof.role)).toEqual(['left-roof', 'right-roof']);
    expect((draft?.frontWall.extra_json as any)?.geometry_face?.kind).toBe('profiled-line-face');
    expect(getDormerBundleMetadata({ ...makeHostRoof(), extra_json: draft?.frontWall.extra_json } as any)?.roof_names).toHaveLength(2);
    expect(draft?.leftCheekWall.width).toBeLessThan(draft?.roofs[0]?.element.width ?? Number.POSITIVE_INFINITY);
    const leftRoof = draft?.roofs[0];
    const rightRoof = draft?.roofs[1];
    const leftRoofPoints = (leftRoof?.element.extra_json as any)?.geometry_face?.points as Array<{ x: number; y: number; z: number }> | undefined;
    const rightRoofPoints = (rightRoof?.element.extra_json as any)?.geometry_face?.points as Array<{ x: number; y: number; z: number }> | undefined;
    expectPointSetEqual((leftRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], resolved?.leftRoofPolygon ?? []);
    expectPointSetEqual(leftRoofPoints ?? [], resolved?.leftRoofFacePoints ?? []);
    expectPointSetEqual((rightRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], resolved?.rightRoofPolygon ?? []);
    expectPointSetEqual(rightRoofPoints ?? [], resolved?.rightRoofFacePoints ?? []);
    expect((draft?.leftCheekWall.extra_json as any)?.geometry_face?.kind).toBe('planar-face-3d');
    expectPointSetEqual((draft?.leftCheekWall.extra_json as any)?.geometry_face?.points ?? [], [
      { x: resolved?.leftValleyPoint.x ?? 0, y: resolved?.leftValleyPoint.y ?? 0, z: resolved?.leftValleyPoint.elevation ?? 0 },
      { x: resolved?.frontLeft.x ?? 0, y: resolved?.frontLeft.y ?? 0, z: resolved?.frontBaseHeight ?? 0 },
      { x: resolved?.frontLeft.x ?? 0, y: resolved?.frontLeft.y ?? 0, z: resolved?.roofFrontBaseHeight ?? 0 },
    ]);
    expect(resolved?.cutoutPolygon).toHaveLength(5);
    expectPointSetEqual(resolved?.cutoutPolygon ?? [], [
      resolved?.frontLeft ?? { x: 0, y: 0, z: 0 },
      resolved?.frontRight ?? { x: 0, y: 0, z: 0 },
      resolved?.rightValleyPoint ?? { x: 0, y: 0, z: 0 },
      resolved?.ridgeBack ?? { x: 0, y: 0, z: 0 },
      resolved?.leftValleyPoint ?? { x: 0, y: 0, z: 0 },
    ]);
  });

  it('builds hip dormers with three stored roof members', () => {
    const host = makeHostRoof();
    const windowCenterPlanPoint = { x: 2, y: 1 };
    const draft = buildDormerBundleDraft({
      host,
      dormerType: 'hip',
      windowCenterPlanPoint,
    });
    const resolved = resolveDormerGeometry({
      host,
      dormerType: 'hip',
      windowCenterPlanPoint,
    });

    expect(draft).not.toBeNull();
    expect(resolved).not.toBeNull();
    expect(draft?.names.roofs).toHaveLength(3);
    expect(draft?.roofs.map((roof) => roof.role)).toEqual(['front-roof', 'left-roof', 'right-roof']);
    expect((draft?.roofs[0]?.element.extra_json as any)?.geometry_face?.kind).toBe('planar-face-3d');
    expect((draft?.frontWall.extra_json as any)?.geometry_face).toBeUndefined();
    const leftRoof = draft?.roofs.find((roof) => roof.role === 'left-roof');
    const rightRoof = draft?.roofs.find((roof) => roof.role === 'right-roof');
    const leftRoofPoints = (leftRoof?.element.extra_json as any)?.geometry_face?.points as Array<{ x: number; y: number; z: number }> | undefined;
    const rightRoofPoints = (rightRoof?.element.extra_json as any)?.geometry_face?.points as Array<{ x: number; y: number; z: number }> | undefined;
    expectPointSetEqual((leftRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], resolved?.leftRoofPolygon ?? []);
    expectPointSetEqual(leftRoofPoints ?? [], resolved?.leftRoofFacePoints ?? []);
    expectPointSetEqual((rightRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], resolved?.rightRoofPolygon ?? []);
    expectPointSetEqual(rightRoofPoints ?? [], resolved?.rightRoofFacePoints ?? []);
    expect(resolved?.cutoutPolygon).toHaveLength(5);
    expectPointSetEqual(resolved?.cutoutPolygon ?? [], [
      resolved?.frontLeft ?? { x: 0, y: 0, z: 0 },
      resolved?.frontRight ?? { x: 0, y: 0, z: 0 },
      resolved?.rightValleyPoint ?? { x: 0, y: 0, z: 0 },
      resolved?.ridgeBack ?? { x: 0, y: 0, z: 0 },
      resolved?.leftValleyPoint ?? { x: 0, y: 0, z: 0 },
    ]);
  });

  it('keeps dormer wall and roof arrows facing outward across rotated mono-pitch hosts', () => {
    for (const angle of ROTATED_HOST_ANGLES) {
      const host = makeRotatedHostRoof(angle);
      const windowCenter = (host.extra_json as any).testWindowCenter;
      const draft = buildDormerBundleDraft({
        host,
        dormerType: 'mono-pitch',
        windowCenterPlanPoint: windowCenter,
      });

      expect(draft).not.toBeNull();
      const interiorPoint = getDormerInteriorPoint(host, draft?.leftCheekWall.width ?? 0);

      expectArrowAwayFromInterior(draft?.frontWall.coordinates ?? [], interiorPoint);
      expectArrowAwayFromInterior(draft?.leftCheekWall.coordinates ?? [], interiorPoint);
      expectArrowAwayFromInterior(draft?.rightCheekWall.coordinates ?? [], interiorPoint);
      expectArrowAwayFromInterior(draft?.window.coordinates ?? [], interiorPoint);
      expectArrowAwayFromInterior(draft?.roof.coordinates ?? [], interiorPoint);
      expectOrientationMatchesLeadEdgeOutwardNormal(draft?.roof ?? {});
    }
  });

  it('supports a flat mono-pitch dormer roof', () => {
    const host = makeRotatedHostRoof(0);
    const windowCenter = (host.extra_json as any).testWindowCenter;
    const resolved = resolveDormerGeometry({
      host,
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: windowCenter,
      placementDefaults: {
        dormerRoofPitch: 0,
      },
    });
    const draft = buildDormerBundleDraft({
      host,
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: windowCenter,
      placementDefaults: {
        dormerRoofPitch: 0,
      },
    });

    expect(resolved).not.toBeNull();
    expect(draft).not.toBeNull();
    expect(resolved?.dormerRoofPitch).toBe(0);
    expect(draft?.roof.pitch).toBe(0);
    expect((resolved?.rearBaseHeight ?? 0) - (resolved?.roofFrontBaseHeight ?? 0)).toBeCloseTo(0, 6);
    expect((resolved?.frontWallHeight ?? 0)).toBeGreaterThan(0.1);
    expectArrowAwayFromInterior(
      draft?.roof.coordinates ?? [],
      getDormerInteriorPoint(host, draft?.leftCheekWall.width ?? 0),
    );
    expectOrientationMatchesLeadEdgeOutwardNormal(draft?.roof ?? {});
  });

  it('keeps the front wall and window outward arrows aligned across rotated mono-pitch hosts', () => {
    for (const angle of ROTATED_HOST_ANGLES) {
      const host = makeRotatedHostRoof(angle);
      const windowCenter = (host.extra_json as any).testWindowCenter;
      const draft = buildDormerBundleDraft({
        host,
        dormerType: 'mono-pitch',
        windowCenterPlanPoint: windowCenter,
      });

      expect(draft).not.toBeNull();
      const interiorPoint = getDormerInteriorPoint(host, draft?.leftCheekWall.width ?? 0);

      expectArrowAwayFromInterior(draft?.frontWall.coordinates ?? [], interiorPoint);
      expectArrowAwayFromInterior(draft?.window.coordinates ?? [], interiorPoint);
      expectArrowsAligned(draft?.frontWall.coordinates ?? [], draft?.window.coordinates ?? []);
    }
  });

  it('keeps dormer roof arrows facing outward across rotated gable and hip hosts', () => {
    for (const dormerType of ['gable-front', 'hip'] as const) {
      for (const angle of ROTATED_HOST_ANGLES) {
        const host = makeRotatedHostRoof(angle);
        const windowCenter = (host.extra_json as any).testWindowCenter;
        const draft = buildDormerBundleDraft({
          host,
          dormerType,
          windowCenterPlanPoint: windowCenter,
        });

        expect(draft).not.toBeNull();
        const interiorPoint = getDormerInteriorPoint(host, draft?.leftCheekWall.width ?? 0);

        for (const roof of draft?.roofs ?? []) {
          expectArrowAwayFromInterior((roof.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], interiorPoint);
          expectOrientationMatchesLeadEdgeOutwardNormal(roof.element);
        }
      }
    }
  });

  it('propagates unheated pitched roof defaults to all gable and hip dormer roof members', () => {
    for (const dormerType of ['gable-front', 'hip'] as const) {
      const draft = buildDormerBundleDraft({
        host: makeHostRoof(),
        dormerType,
        windowCenterPlanPoint: { x: 2, y: 1 },
        placementDefaults: {
          isUnheatedPitchedRoof: true,
        },
      });

      expect(draft).not.toBeNull();
      expect(draft?.roofs.length).toBeGreaterThan(1);
      expect(draft?.roofs.every((roof) => roof.element.is_unheated_pitched_roof === true)).toBe(true);
    }
  });

  it('keeps gable-front roof member arrows outward for each roof role', () => {
    for (const angle of ROTATED_HOST_ANGLES) {
      const host = makeRotatedHostRoof(angle);
      const windowCenter = (host.extra_json as any).testWindowCenter;
      const draft = buildDormerBundleDraft({
        host,
        dormerType: 'gable-front',
        windowCenterPlanPoint: windowCenter,
      });

      expect(draft).not.toBeNull();
      const interiorPoint = getDormerInteriorPoint(host, draft?.leftCheekWall.width ?? 0);
      const leftRoof = draft?.roofs.find((roof) => roof.role === 'left-roof');
      const rightRoof = draft?.roofs.find((roof) => roof.role === 'right-roof');

      expect(leftRoof).toBeDefined();
      expect(rightRoof).toBeDefined();
      expectArrowAwayFromInterior((leftRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], interiorPoint);
      expectArrowAwayFromInterior((rightRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], interiorPoint);
      expectOrientationMatchesLeadEdgeOutwardNormal(leftRoof?.element ?? {});
      expectOrientationMatchesLeadEdgeOutwardNormal(rightRoof?.element ?? {});
      expectLeadEdgeMatchesSegment(
        (leftRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [],
        (draft?.leftCheekWall.coordinates as Array<{ x: number; y: number; z: number }>) ?? [],
      );
      expectLeadEdgeMatchesSegment(
        (rightRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [],
        (draft?.rightCheekWall.coordinates as Array<{ x: number; y: number; z: number }>) ?? [],
      );
    }
  });

  it('keeps equivalent gable-front dormer roof arrows diverging outward in plan', () => {
    const host = makeRotatedHostRoof(0);
    const windowCenter = (host.extra_json as any).testWindowCenter;
    const draft = buildDormerBundleDraft({
      host,
      dormerType: 'gable-front',
      windowCenterPlanPoint: windowCenter,
      placementDefaults: {
        dormerWidth: 2,
        dormerDepth: 3.141,
        frontWallHeight: 0.9,
        dormerRoofPitch: 15,
        gableRoofPitch: 35,
        windowWidth: 1.2,
        windowHeight: 0.7,
        windowSillHeight: 0.05,
        frameAreaFraction: 0.25,
      },
    });

    expect(draft).not.toBeNull();
    const interiorPoint = getDormerInteriorPoint(host, draft?.leftCheekWall.width ?? 0);
    const leftRoof = draft?.roofs.find((roof) => roof.role === 'left-roof');
    const rightRoof = draft?.roofs.find((roof) => roof.role === 'right-roof');

    expect(leftRoof).toBeDefined();
    expect(rightRoof).toBeDefined();

    const leftArrow = getArrowVector((leftRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? []);
    const rightArrow = getArrowVector((rightRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? []);
    const leftRoofCoords = (leftRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [];
    const rightRoofCoords = (rightRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [];
    const leftCenterX = leftRoofCoords.reduce((sum, point) => sum + point.x, 0) / leftRoofCoords.length;
    const rightCenterX = rightRoofCoords.reduce((sum, point) => sum + point.x, 0) / rightRoofCoords.length;

    expectArrowAwayFromInterior(leftRoofCoords, interiorPoint);
    expectArrowAwayFromInterior(rightRoofCoords, interiorPoint);
    expect(Math.sign(leftArrow.x)).toBe(Math.sign(leftCenterX - windowCenter.x));
    expect(Math.sign(rightArrow.x)).toBe(Math.sign(rightCenterX - windowCenter.x));
    expectOrientationMatchesLeadEdgeOutwardNormal(leftRoof?.element ?? {});
    expectOrientationMatchesLeadEdgeOutwardNormal(rightRoof?.element ?? {});
  });

  it('keeps hip roof member arrows outward for each roof role', () => {
    for (const angle of ROTATED_HOST_ANGLES) {
      const host = makeRotatedHostRoof(angle);
      const windowCenter = (host.extra_json as any).testWindowCenter;
      const draft = buildDormerBundleDraft({
        host,
        dormerType: 'hip',
        windowCenterPlanPoint: windowCenter,
      });

      expect(draft).not.toBeNull();
      const interiorPoint = getDormerInteriorPoint(host, draft?.leftCheekWall.width ?? 0);
      const frontRoof = draft?.roofs.find((roof) => roof.role === 'front-roof');
      const leftRoof = draft?.roofs.find((roof) => roof.role === 'left-roof');
      const rightRoof = draft?.roofs.find((roof) => roof.role === 'right-roof');

      expect(frontRoof).toBeDefined();
      expect(leftRoof).toBeDefined();
      expect(rightRoof).toBeDefined();
      expectArrowAwayFromInterior((frontRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], interiorPoint);
      expectArrowAwayFromInterior((leftRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], interiorPoint);
      expectArrowAwayFromInterior((rightRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [], interiorPoint);
      expectOrientationMatchesLeadEdgeOutwardNormal(frontRoof?.element ?? {});
      expectOrientationMatchesLeadEdgeOutwardNormal(leftRoof?.element ?? {});
      expectOrientationMatchesLeadEdgeOutwardNormal(rightRoof?.element ?? {});
      expectLeadEdgeMatchesSegment(
        (leftRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [],
        (draft?.leftCheekWall.coordinates as Array<{ x: number; y: number; z: number }>) ?? [],
      );
      expectLeadEdgeMatchesSegment(
        (rightRoof?.element.coordinates as Array<{ x: number; y: number; z: number }>) ?? [],
        (draft?.rightCheekWall.coordinates as Array<{ x: number; y: number; z: number }>) ?? [],
      );
    }
  });

  it('matches 3D mapper: planar pitched host with base_height 0 uses storey floor slab; explicit base_height wins', () => {
    const floors = [
      { id: '0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
      { id: '1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: true },
    ];
    const planarPitchedAtFirst = makeHostRoof({
      base_height: 0,
      floorId: '1',
      coordinates: [
        { x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }, { x: 4, y: 3, z: 1 }, { x: 0, y: 3, z: 1 },
      ],
    });

    // Sloped (pitch in (0,90)) planar host with placeholder base_height anchors at the
    // storey floor slab — the eaves rest on the bearing wall plate. Top-of-Ground = 2.4.
    expect(getDormerHostBaseElevationM(planarPitchedAtFirst, floors)).toBeCloseTo(2.4, 6);

    // Explicit non-zero base_height overrides the placeholder rule.
    expect(
      getDormerHostBaseElevationM(
        { ...planarPitchedAtFirst, base_height: 3.7 } as typeof planarPitchedAtFirst,
        floors,
      ),
    ).toBeCloseTo(3.7, 6);
  });
});

describe('dormer bundle name auto/manual detection', () => {
  const makeAnchor = (overrides: { bundleName?: string | null } = {}): Element => {
    const draft = buildDormerBundleDraft({
      host: makeHostRoof(),
      dormerType: 'mono-pitch',
      windowCenterPlanPoint: { x: 2, y: 1 },
    });
    const bundle = {
      ...(draft?.frontWall.extra_json?.dormer_bundle as Record<string, unknown>),
    };
    if ('bundleName' in overrides) {
      if (overrides.bundleName == null) delete bundle.bundle_name;
      else bundle.bundle_name = overrides.bundleName;
    }
    return {
      ...makeHostRoof(),
      id: 'dormer-anchor',
      name: draft?.names.frontWall ?? 'MainRoof Dormer Front Wall 1',
      extra_json: { dormer_bundle: bundle },
    } as unknown as Element;
  };

  it('treats the generated "<host> Dormer N" name as automatic', () => {
    expect(looksLikeAutoDormerBundleName('MainRoof Dormer 1', 'MainRoof')).toBe(true);
    expect(looksLikeAutoDormerBundleName('MainRoof Dormer', 'MainRoof')).toBe(true);
    expect(looksLikeAutoDormerBundleName('Loft dormer', 'MainRoof')).toBe(false);

    const autoAnchor = makeAnchor();
    expect(isDormerBundleNameManual(autoAnchor)).toBe(false);
  });

  it('treats a user-overridden bundle name as manual', () => {
    const manualAnchor = makeAnchor({ bundleName: 'Front bedroom dormer' });
    expect(isDormerBundleNameManual(manualAnchor)).toBe(true);
  });

  it('computes the canonical auto bundle name, excluding the current bundle', () => {
    const anchor = makeAnchor({ bundleName: 'Front bedroom dormer' });
    const autoName = computeAutoDormerBundleName(anchor, { [anchor.id]: anchor });
    expect(autoName).toBe('MainRoof Dormer 1');
  });
});

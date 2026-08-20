// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Billboard, Html, OrbitControls, Grid, Edges, Line } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { Element, Floor } from '../../geometry/types';
import { useGeometryStore } from '../../stores/geometryStore';
import { useThemeStore } from '../../stores/themeStore';
import {
  buildGeometry3DPrimitives,
  type Geometry3DPrimitive,
  type PointMarkerPrimitive,
} from '../../lib/geometry3dMapper';
import {
  buildGeometry3DEditHandleModel,
  buildSharedVertexPositionUpdates,
  isParentConstrainedLineElement,
  projectParentConstrainedLineCoordinates,
  type Geometry3DElevationMode,
  type Geometry3DEditElevationHandle,
  type Geometry3DEditHandleModel,
  type Geometry3DEditPitchHandle,
  type Geometry3DEditVertexHandle,
} from '../../lib/geometry3dEditHandles';
import {
  findClosestSnapCorner,
  translateShapeToSnapFromCache,
  type GeometrySnapCache,
} from '../../lib/snapUtils';
import { readRootCssVar } from '../../lib/cssVars';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import type { WindowVentilation3D } from '../../lib/geometry3dPrimitivesTypes';
import { computeElement3DFrameTarget } from '../../lib/geometry3dFrame';
import { buildClosedPrismGeometry, buildSlopedPolygonBufferGeometry, elevationAtSlopedVertexM } from '../../lib/geometry3dSloped';
import { modelXYToThreeXZ, modelSegmentToThreeYaw, modelXYToExtrudeShapeXY } from '../../lib/geometryTransform';
import { roundToTwoDecimals } from '../../geometry/constants';
import { frameInsetFromFrameAreaFraction, rectSizeForMaxOpenArea } from '../../lib/geometryVentilationOverlay';
import { deriveDormerHostBasis, getDormerBundleInfo, getDormerHostBaseElevationM } from '../../lib/dormerGeometry';
import { isOrientationPitchAxis } from '../../lib/slopePitchAxis';
import {
  floorDimmedMeshColor,
  floorDimmingOverlayScale,
  meshRenderOrderForFloor,
  meshStandardFloorDimmingProps,
  meshStandardFloorDimmingPropsWithBaseOpacity,
  planarFaceFloorDimmingProps,
} from '../../lib/elementCanvasFloor3dMaterial';
import { isElementOnActiveCanvasFloor } from '../../lib/elementCanvasFloor';
import { materialDimForCategoryGhost, CATEGORY_GHOST_OPACITY_FACTOR } from '../../lib/elementCategoryVisibility';
import { ignoreObjectRaycast as ignoreRaycast, meshRaycastForInteractivity } from '../../lib/geometry3dRaycast';
import { paintLucideIconOnCanvas } from '../../lib/lucideIconCanvas';
import { isServiceLineElementType } from '../../lib/serviceLineDrawModes';
import { selectionForElement } from '../../lib/drawnElementSelection';
import { mergeUnheatedPitchedRoofCeilingElevationExtraJson } from '../../lib/unheatedPitchedRoofCeiling';
import { useKeyedState } from '../../hooks/useKeyedState';
import { createGeometryCanvasRenderer } from './geometryCanvasRenderer';
import {
  cascadeHostedDescendantGeometry,
  cascadeHostedDescendantTranslation,
} from '../../lib/hostedDescendantCascade';
interface Selection {
  type: 'zone' | 'element' | 'global' | 'dormer';
  id: string;
  isPlaceholder?: boolean;
}

/** Slight depth bias so coplanar opening faces don’t fight wall faces */
const WALL_POLYGON_OFFSET = { factor: 1, units: 1 } as const;
const OPENING_POLYGON_OFFSET = { factor: -1, units: -4 } as const;
const SELECTION_OVERLAY_OPACITY = 0.36;
const HOVER_OVERLAY_OPACITY = 0.24;
const SELECTION_OVERLAY_POLYGON_OFFSET = { factor: -1, units: -8 } as const;
const DORMER_CUTOUT_OUTLINE_ELEVATION_M = 0.02;
const FALLBACK_HEIGHT_WALL_OPACITY = 0.44;

/** Linear service runs (thermal bridges, pipework, ductwork): shared cylinder radius. */
const THERMAL_LINEAR_CYLINDER_RADIUS_M = 0.04;
/** Selection halo: linear TB geometry is a thin cylinder — scale radius so highlight reads in 3D. */
const THERMAL_BRIDGE_SELECTION_RADIUS_SCALE = 2.15;
const THERMAL_BRIDGE_HOVER_RADIUS_SCALE = 2.7;
const THERMAL_BRIDGE_SELECTION_OVERLAY_OPACITY = 0.55;
const THERMAL_BRIDGE_HOVER_OVERLAY_OPACITY = 0.42;
const THERMAL_BRIDGE_SELECTED_EMISSIVE_INTENSITY = 0.62;
const EDIT_HANDLE_CENTER_RADIUS_M = 0.16;
const EDIT_HANDLE_ENDPOINT_SIZE_M = 0.22;
const EDIT_HANDLE_ELEVATION_RADIUS_M = 0.11;
const EDIT_HANDLE_ELEVATION_STEM_RADIUS_M = 0.018;
const EDIT_HANDLE_ELEVATION_PX_TO_M = 0.01;
const EDIT_HANDLE_PITCH_RADIUS_M = 0.13;
const EDIT_HANDLE_PITCH_PX_TO_DEG = 0.12;
const EDIT_HANDLE_DRAG_LABEL_OFFSET_M = 0.32;
const EDIT_HANDLE_SNAP_MARKER_RADIUS_M = 0.08;

function openingEdgeColor(kind: 'window' | 'door'): string {
  return kind === 'window'
    ? readRootCssVar('--canvas-3d-window-edge', '#7ec8ff')
    : readRootCssVar('--canvas-3d-door-edge', '#ffb366');
}

function openingEmissive(
  kind: 'window' | 'door',
  isCurrentFloor: boolean,
): { emissive: string; emissiveIntensity: number } {
  const windowEmissive = readRootCssVar('--canvas-3d-window-emissive', '#153a5c');
  const doorEmissive = readRootCssVar('--canvas-3d-door-emissive', '#5c3010');
  if (!isCurrentFloor) {
    const muted = kind === 'window'
      ? floorDimmedMeshColor(windowEmissive, false)
      : floorDimmedMeshColor(doorEmissive, false);
    return { emissive: muted, emissiveIntensity: 0.12 };
  }
  if (kind === 'window') return { emissive: windowEmissive, emissiveIntensity: 0.5 };
  return { emissive: doorEmissive, emissiveIntensity: 0.45 };
}

const SelectionOverlayMaterial: React.FC<{
  doubleSided?: boolean;
  opacity?: number;
  color?: string;
}> = ({ doubleSided = false, opacity = SELECTION_OVERLAY_OPACITY, color }) => (
  <meshBasicMaterial
    color={color ?? readRootCssVar('--canvas-3d-selection-overlay', '#fff176')}
    transparent
    opacity={opacity}
    depthWrite={false}
    side={doubleSided ? THREE.DoubleSide : THREE.FrontSide}
    toneMapped={false}
    polygonOffset
    polygonOffsetFactor={SELECTION_OVERLAY_POLYGON_OFFSET.factor}
    polygonOffsetUnits={SELECTION_OVERLAY_POLYGON_OFFSET.units}
  />
);

const HoverOverlayMaterial: React.FC<{
  doubleSided?: boolean;
  opacity?: number;
}> = ({ doubleSided = false, opacity = HOVER_OVERLAY_OPACITY }) => (
  <SelectionOverlayMaterial
    color={readRootCssVar('--canvas-3d-hover-overlay', '#5eead4')}
    doubleSided={doubleSided}
    opacity={opacity}
  />
);

type HoverPointerEvent = { stopPropagation: () => void };
type HoverHandlers = {
  onPointerOver?: (event: HoverPointerEvent) => void;
  onPointerOut?: (event: HoverPointerEvent) => void;
};
const EMPTY_HOVER_HANDLERS: HoverHandlers = {};

function useHoverHalo(isInteractive: boolean): [boolean, HoverHandlers] {
  const [hovered, setHovered] = useState(false);

  const handlers = useMemo<HoverHandlers>(() => {
    if (!isInteractive) return EMPTY_HOVER_HANDLERS;
    return {
      onPointerOver: (event) => {
        event.stopPropagation();
        setHovered(true);
      },
      onPointerOut: (event) => {
        event.stopPropagation();
        setHovered(false);
      },
    };
  }, [isInteractive]);

  return [isInteractive && hovered, handlers];
}

/**
 * `thicknessM`, when given, produces a solid prism (via `buildClosedPrismGeometry`, extruded
 * symmetrically ±thicknessM/2 along the face normal) instead of a zero-thickness sheet — used
 * for profiled-top walls and their profiled openings so they read as real walls/windows in 3D
 * rather than vanishing flat cards.
 */
// eslint-disable-next-line react-refresh/only-export-components -- geometry helper shared with tests.
export function buildPlanarFaceGeometry(
  points: Array<[number, number, number]>,
  thicknessM?: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  if (points.length < 3) return geometry;

  const vertices = points.map(([modelX, elevation, modelY]) => {
    const [x, z] = modelXYToThreeXZ([modelX, modelY]);
    return new THREE.Vector3(x, elevation, z);
  });

  let planeNormal: THREE.Vector3 | null = null;
  for (let i = 1; i < vertices.length - 1; i += 1) {
    const ab = vertices[i].clone().sub(vertices[0]);
    const ac = vertices[i + 1].clone().sub(vertices[0]);
    const cross = new THREE.Vector3().crossVectors(ab, ac);
    if (cross.lengthSq() > 1e-12) {
      planeNormal = cross.normalize();
      break;
    }
  }
  if (!planeNormal) return geometry;

  const tangent = vertices[1].clone().sub(vertices[0]).normalize();
  if (tangent.lengthSq() < 1e-12) return geometry;
  const bitangent = new THREE.Vector3().crossVectors(planeNormal, tangent).normalize();
  if (bitangent.lengthSq() < 1e-12) return geometry;

  const contour = vertices.map((vertex) => {
    const delta = vertex.clone().sub(vertices[0]);
    return new THREE.Vector2(delta.dot(tangent), delta.dot(bitangent));
  });
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  if (triangles.length === 0) return geometry;

  if (thicknessM !== undefined && thicknessM > 0) {
    // Symmetric prism about the face plane. The projected contour can come out clockwise when
    // the fan triangle at vertex 0 disagrees with the ring's overall orientation (concave
    // profiled tops) — buildClosedPrismGeometry reverses the side winding in that case so caps
    // and sides stay consistently outward.
    const half = thicknessM / 2;
    const top = vertices.map((vertex) => vertex.clone().addScaledVector(planeNormal, half));
    const bottom = vertices.map((vertex) => vertex.clone().addScaledVector(planeNormal, -half));
    return buildClosedPrismGeometry(top, bottom, triangles, THREE.ShapeUtils.area(contour) < 0);
  }

  const positions: number[] = [];
  const normals: number[] = [];
  for (const vertex of vertices) {
    positions.push(vertex.x, vertex.y, vertex.z);
    normals.push(planeNormal.x, planeNormal.y, planeNormal.z);
  }

  const indices: number[] = [];
  for (const triangle of triangles) {
    indices.push(triangle[0], triangle[1], triangle[2]);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

type DormerCutoutOverlay = {
  hostElementId: string;
  points: Array<[number, number, number]>;
};

function getDormerCutoutOutlinePoints(
  hostElement: Element,
  cutoutPolygon: Array<{ x: number; y: number; z: number }>,
  floors: Floor[],
  globalOrientationOffset?: number,
): Array<[number, number, number]> {
  if (hostElement.type !== 'BuildingElementOpaque' || cutoutPolygon.length < 3) return [];
  const hostBaseElevationM = getDormerHostBaseElevationM(hostElement, floors);

  const hostPitch = hostElement.pitch;
  if (typeof hostPitch === 'number' && Number.isFinite(hostPitch) && hostPitch > 0 && hostPitch < 90) {
    const hostBasis = deriveDormerHostBasis(hostElement, globalOrientationOffset);
    if (hostBasis) {
      return cutoutPolygon.map((point) => {
        const [x, z] = modelXYToThreeXZ([point.x, point.y]);
        return [
          x,
          elevationAtSlopedVertexM(
            [point.x, point.y],
            hostBasis.eavesStart,
            hostBasis.vAxis,
            hostBaseElevationM,
            hostPitch,
          ) + DORMER_CUTOUT_OUTLINE_ELEVATION_M,
          z,
        ];
      });
    }
    if (isOrientationPitchAxis(hostElement)) return [];
  }

  return cutoutPolygon.map((point) => {
    const [x, z] = modelXYToThreeXZ([point.x, point.y]);
    return [x, hostBaseElevationM + DORMER_CUTOUT_OUTLINE_ELEVATION_M, z];
  });
}

function collectDormerCutoutOverlays(
  elementsById: Record<string, Element>,
  floors: Floor[],
  selection: Selection | null,
  globalOrientationOffset?: number,
): DormerCutoutOverlay[] {
  if (!selection) return [];

  const overlays: DormerCutoutOverlay[] = [];
  const seen = new Set<string>();
  const hostElementsByName = new Map(
    Object.values(elementsById).map((element) => [element.name, element] as const),
  );
  // Pre-compute effective storey heights so downstream getDormerHostBaseElevationM sees the
  // same slab elevations as the dropdown / cascade / 3D renderer.
  const effectiveFloors = floors.length > 0
    ? withEffectiveStoreyHeights(floors, Object.values(elementsById))
    : floors;

  const maybeAddOverlay = (element: Element) => {
    const bundleInfo = getDormerBundleInfo(element);
    if (!bundleInfo || bundleInfo.role !== 'front-wall-anchor' || bundleInfo.cutout_polygon.length < 3) return;

    const hostElement = hostElementsByName.get(bundleInfo.host_element_name);
    if (!hostElement || hostElement.type !== 'BuildingElementOpaque') return;

    const overlayKey = `${hostElement.id}:${bundleInfo.bundle_id}`;
    if (seen.has(overlayKey)) return;

    const points = getDormerCutoutOutlinePoints(
      hostElement,
      bundleInfo.cutout_polygon,
      effectiveFloors,
      globalOrientationOffset,
    );
    if (points.length < 3) return;

    seen.add(overlayKey);
    overlays.push({ hostElementId: hostElement.id, points });
  };

  if (selection.type === 'dormer') {
    Object.values(elementsById).forEach((element) => {
      const bundleInfo = getDormerBundleInfo(element);
      if (bundleInfo?.bundle_id === selection.id) {
        maybeAddOverlay(element);
      }
    });
    return overlays;
  }

  if (selection.type === 'element') {
    const selectedElement = elementsById[selection.id];
    if (selectedElement?.type !== 'BuildingElementOpaque') return overlays;

    Object.values(elementsById).forEach((element) => {
      const bundleInfo = getDormerBundleInfo(element);
      if (bundleInfo?.host_element_name === selectedElement.name) {
        maybeAddOverlay(element);
      }
    });
  }

  return overlays;
}

/**
 * Polygon window overlays: align to the same Ry convention as {@link modelSegmentToThreeYaw} (wall segments),
 * and place the opening rectangle at the centre of the plan OBB along that longest edge — not the edge
 * midpoint alone, which skewed loops off the extruded mesh.
 */
function computePolygonWindowFaceBasis(primitive: Extract<Geometry3DPrimitive, { kind: 'polygon-prism' }>): {
  position: [number, number, number];
  yaw: number;
  faceWidth: number;
} {
  const ring = primitive.points;
  if (ring.length < 3) {
    const [x, z] = modelXYToThreeXZ(ring[0] ?? [0, 0]);
    return {
      position: [x, primitive.baseElevationM + primitive.heightM / 2, z],
      yaw: 0,
      faceWidth: 0.02,
    };
  }

  let maxLen = 0;
  let ia = 0;
  let ib = 1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > maxLen) {
      maxLen = len;
      ia = i;
      ib = (i + 1) % ring.length;
    }
  }

  const yaw = modelSegmentToThreeYaw(ring[ia], ring[ib]);

  const worldPts = ring.map((p) => {
    const [tx, tz] = modelXYToThreeXZ(p);
    return { x: tx, z: tz };
  });
  const a = worldPts[ia];
  const b = worldPts[ib];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const elen = Math.hypot(dx, dz);
  const ux = elen > 1e-9 ? dx / elen : 1;
  const uz = elen > 1e-9 ? dz / elen : 0;
  const vx = -uz;
  const vz = ux;

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of worldPts) {
    const projU = p.x * ux + p.z * uz;
    const projV = p.x * vx + p.z * vz;
    minU = Math.min(minU, projU);
    maxU = Math.max(maxU, projU);
    minV = Math.min(minV, projV);
    maxV = Math.max(maxV, projV);
  }
  const midU = (minU + maxU) / 2;
  const midV = (minV + maxV) / 2;
  const cx = midU * ux + midV * vx;
  const cz = midU * uz + midV * vz;
  const faceWidth = Math.max(0.02, maxU - minU);
  const cy = primitive.baseElevationM + primitive.heightM / 2;
  return { position: [cx, cy, cz], yaw, faceWidth };
}

/** Tiny billboard labels for ventilation overlays (names match CSV / element editor fields). */
const VentilationMicroLabel: React.FC<{
  position: [number, number, number];
  color: string;
  title: string;
  detail?: string;
}> = ({ position, color, title, detail }) => (
  <Html position={position} center sprite distanceFactor={16} style={{ pointerEvents: 'none' }}>
    <div
      style={{
        fontSize: 8,
        lineHeight: 1.15,
        fontFamily: 'system-ui, sans-serif',
        color,
        textShadow: readRootCssVar('--canvas-3d-label-shadow', '0 1px 2px rgba(0, 0, 0, 0.92)'),
        whiteSpace: 'nowrap',
        textAlign: 'center',
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      {detail ? <div style={{ opacity: 0.9, fontSize: 7 }}>{detail}</div> : null}
    </div>
  </Html>
);

/**
 * Semi-transparent + line overlays on the window opening face (local +Z = outward from mesh).
 *
 * - **Amber rectangle**: `max_window_open_area` — a loop whose area equals that value (capped by the opening); not necessarily how the sash looks, it is the modelled max openable area.
 * - **Cream inset rectangle**: `frame_area_fraction` — uniform inset so inner area = (1 − fraction) × opening area (frame share of opening area).
 */
const WindowVentilationFaceLayers: React.FC<{
  faceWidth: number;
  faceHeight: number;
  zFace: number;
  v: WindowVentilation3D;
  /** Match parent mesh dimming when window is not on the active canvas floor (see {@link floorDimmingOverlayScale}). */
  overlayScale?: number;
}> = ({ faceWidth: W, faceHeight: H, zFace, v, overlayScale = 1 }) => {
  const layers = { free: zFace + 0.001, maxOpen: zFace + 0.003, frame: zFace + 0.005 };

  const freeH =
    typeof v.free_area_height === 'number' && Number.isFinite(v.free_area_height)
      ? Math.min(Math.max(0, v.free_area_height), H)
      : 0;

  const frameFrac =
    typeof v.frame_area_fraction === 'number' && Number.isFinite(v.frame_area_fraction)
      ? Math.min(1, Math.max(0, v.frame_area_fraction))
      : 0;

  const inset = frameFrac > 0 ? frameInsetFromFrameAreaFraction(frameFrac, W, H) : 0;
  const frameInnerW = W - 2 * inset;
  const frameInnerH = H - 2 * inset;

  let maxOpenW = 0;
  let maxOpenH = 0;
  if (typeof v.max_window_open_area === 'number' && Number.isFinite(v.max_window_open_area) && v.max_window_open_area > 0) {
    const cap = W * H;
    const A = Math.min(v.max_window_open_area, cap);
    const r = rectSizeForMaxOpenArea(A, W, H);
    maxOpenW = r.w;
    maxOpenH = r.h;
  }

  return (
    <group renderOrder={4}>
      {freeH > 0.001 ? (
        <mesh position={[0, -H / 2 + freeH / 2, layers.free]}>
          <planeGeometry args={[W, freeH]} />
          <meshBasicMaterial
            color={readRootCssVar('--canvas-3d-vent-free-area', '#22d3ee')}
            transparent
            opacity={0.28 * overlayScale}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ) : null}

      {maxOpenW > 0.001 && maxOpenH > 0.001 ? (
        <>
          <Line
            position={[0, 0, layers.maxOpen]}
            points={[
              [-maxOpenW / 2, -maxOpenH / 2, 0],
              [maxOpenW / 2, -maxOpenH / 2, 0],
              [maxOpenW / 2, maxOpenH / 2, 0],
              [-maxOpenW / 2, maxOpenH / 2, 0],
              [-maxOpenW / 2, -maxOpenH / 2, 0],
            ]}
            color={readRootCssVar('--canvas-3d-vent-max-open', '#fbbf24')}
            lineWidth={2}
            depthWrite={false}
            transparent
            opacity={0.95 * overlayScale}
          />
          <VentilationMicroLabel
            position={[W / 2 + 0.06, H / 2 + 0.04, layers.maxOpen]}
            color={readRootCssVar('--canvas-3d-vent-max-open', '#fbbf24')}
            title="Max open area"
            detail={
              typeof v.max_window_open_area === 'number' && Number.isFinite(v.max_window_open_area)
                ? `${v.max_window_open_area.toFixed(3)} m²`
                : undefined
            }
          />
        </>
      ) : null}

      {inset > 0.001 && frameInnerW > 0.001 && frameInnerH > 0.001 ? (
        <>
          <Line
            position={[0, 0, layers.frame]}
            points={[
              [-W / 2 + inset, -H / 2 + inset, 0],
              [W / 2 - inset, -H / 2 + inset, 0],
              [W / 2 - inset, H / 2 - inset, 0],
              [-W / 2 + inset, H / 2 - inset, 0],
              [-W / 2 + inset, -H / 2 + inset, 0],
            ]}
            color={readRootCssVar('--canvas-3d-vent-frame', '#f5f0d6')}
            lineWidth={1.5}
            depthWrite={false}
            transparent
            opacity={0.9 * overlayScale}
          />
          <VentilationMicroLabel
            position={[-W / 2 - 0.06, H / 2 + 0.04, layers.frame]}
            color={readRootCssVar('--canvas-3d-vent-frame', '#f5f0d6')}
            title="Frame"
            detail={
              typeof v.frame_area_fraction === 'number' && Number.isFinite(v.frame_area_fraction)
                ? `${(v.frame_area_fraction * 100).toFixed(1)}%`
                : undefined
            }
          />
        </>
      ) : null}
    </group>
  );
};

const WallSegmentWindowVentilationOverlays: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'wall-segment' }>;
  showDetail: boolean;
  length: number;
}> = ({ primitive, showDetail, length }) => {
  if (!showDetail || primitive.elementType !== 'BuildingElementTransparent' || !primitive.windowVentilation) {
    return null;
  }
  const v = primitive.windowVentilation;
  const hasAny = Object.values(v).some((x) => typeof x === 'number' && Number.isFinite(x));
  if (!hasAny) return null;

  const W = length;
  const H = primitive.heightM;
  const T = primitive.thicknessM;
  const zFace = T / 2 + 0.002;

  return (
    <WindowVentilationFaceLayers
      faceWidth={W}
      faceHeight={H}
      zFace={zFace}
      v={v}
      overlayScale={floorDimmingOverlayScale(primitive.isCurrentFloor)}
    />
  );
};

const PolygonPrismWindowVentilationOverlays: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'polygon-prism' }>;
  showDetail: boolean;
}> = ({ primitive, showDetail }) => {
  if (!showDetail || primitive.elementType !== 'BuildingElementTransparent' || !primitive.windowVentilation) {
    return null;
  }
  const v = primitive.windowVentilation;
  const hasAny = Object.values(v).some((x) => typeof x === 'number' && Number.isFinite(x));
  if (!hasAny) return null;

  const { position, yaw, faceWidth } = computePolygonWindowFaceBasis(primitive);
  const H = primitive.heightM;
  const zFace = 0.025;

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <WindowVentilationFaceLayers
        faceWidth={faceWidth}
        faceHeight={H}
        zFace={zFace}
        v={v}
        overlayScale={floorDimmingOverlayScale(primitive.isCurrentFloor)}
      />
    </group>
  );
};

export interface GeometryCanvas3DProps {
  elementsById: Record<string, Element>;
  elementIds: string[];
  floors: Floor[];
  /** Required for orientation-axis sloped geometry; the live canvas always supplies the project value. */
  globalOrientationOffset?: number;
  currentFloorZ?: number;
  selection: Selection | null;
  selectedElementIds: string[];
  setSelection: (selection: Selection | null, additive?: boolean) => void;
  /** From elements panel double-click in 3D — recentre orbit on that element (camera “frame”), not CSV/input reset. */
  frameRequest?: { elementId: string; nonce: number } | null;
  /** Clears `frameRequest` in the parent after the one-shot camera move (must run or every geometry edit re-frames). */
  onFrameRequestConsumed?: () => void;
  /**
   * Per-element: when true, mesh is fully hidden (opacity 0) and does not raycast (picks pass through),
   * matching 2D “hidden category” behaviour.
   */
  isElementCategoryGhost?: (elementId: string) => boolean;
  /** Shared 2D geometry snap cache; reused so 3D handle drags snap to the same corner targets. */
  snapCache?: GeometrySnapCache;
}

const DEFAULT_IS_ELEMENT_CATEGORY_GHOST: NonNullable<GeometryCanvas3DProps['isElementCategoryGhost']> = () => false;

const CAMERA_FRAME_OFFSET = new THREE.Vector3(10, 8, 10);

function isPrimitiveAboveActiveFloor(floorZ: number, currentFloorZ?: number): boolean {
  return currentFloorZ !== undefined && floorZ > currentFloorZ;
}

/**
 * R3F's Canvas calls `configure()` from a layout effect on many renders; passing `onCreated` there
 * re-runs the callback and was resetting the camera. Initialise the default camera once here instead.
 */
const InitialPerspectiveCamera: React.FC<{
  orbitTargetRef: React.MutableRefObject<[number, number, number]>;
}> = ({ orbitTargetRef }) => {
  const { camera } = useThree();
  const done = useRef(false);
  // eslint-disable-next-line react-hooks/immutability -- Three.js camera configuration is an intentional imperative layout effect.
  useLayoutEffect(() => {
    if (done.current) return;
    done.current = true;
    const t = orbitTargetRef.current;
    const p = camera as THREE.PerspectiveCamera;
    // eslint-disable-next-line react-hooks/immutability -- The Three.js camera is mutable external state owned by R3F.
    p.fov = 45;
    p.near = 0.1;
    p.far = 1000;
    p.position.set(t[0] + 10, t[1] + 8, t[2] + 10);
    p.updateProjectionMatrix();
  }, [camera, orbitTargetRef]);
  return null;
};

const OrbitControlsWithFrame = memo(function OrbitControlsWithFrame({
  orbitTargetRef,
  frameRequest,
  primitivesRef,
  onFrameRequestConsumed,
  disabled = false,
}: {
  orbitTargetRef: React.MutableRefObject<[number, number, number]>;
  frameRequest: { elementId: string; nonce: number } | null;
  primitivesRef: React.MutableRefObject<Geometry3DPrimitive[]>;
  onFrameRequestConsumed?: () => void;
  disabled?: boolean;
}) {
  const orbitRef = useRef<OrbitControlsImpl>(null);
  const targetInitialized = useRef(false);

  /** Do not pass `target` to OrbitControls — R3F reapplies props and fights user orbit. Set once after ref attaches. */
  useEffect(() => {
    const orbit = orbitRef.current;
    if (!orbit || targetInitialized.current) return;
    targetInitialized.current = true;
    const t = orbitTargetRef.current;
    orbit.target.set(t[0], t[1], t[2]);
    orbit.update();
  }, [orbitTargetRef]);

  /**
   * Run only when the user requests a new frame (nonce / elementId). Do NOT depend on `primitives`:
   * if `frameRequest` stayed set (previously never cleared) and primitives changed every edit, this
   * re-ran and snapped the camera — felt like “view reset on property change”.
   */
  const frameRequestNonce = frameRequest?.nonce;
  const frameRequestElementId = frameRequest?.elementId;
  useEffect(() => {
    if (frameRequestNonce == null) return;
    const elementId = frameRequestElementId;
    if (!elementId) {
      onFrameRequestConsumed?.();
      return;
    }
    const handle = window.setTimeout(() => {
      const orbit = orbitRef.current;
      if (!orbit) {
        onFrameRequestConsumed?.();
        return;
      }
      const pos = computeElement3DFrameTarget(elementId, primitivesRef.current);
      const t = orbitTargetRef.current;
      const target = new THREE.Vector3(...(pos ?? t));
      orbit.target.copy(target);
      const cam = orbit.object;
      cam.position.copy(target).add(CAMERA_FRAME_OFFSET);
      orbit.update();
      onFrameRequestConsumed?.();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [frameRequestNonce, frameRequestElementId, orbitTargetRef, onFrameRequestConsumed, primitivesRef]);

  return (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enabled={!disabled}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={2}
      maxDistance={200}
    />
  );
});

type Geometry3DEditPointerEvent = {
  stopPropagation: () => void;
  pointerId?: number;
  clientY?: number;
  ray?: THREE.Ray;
  target?: { setPointerCapture?: (pointerId: number) => void; releasePointerCapture?: (pointerId: number) => void };
};

type Geometry3DDragSession =
  | {
      kind: 'element-plan';
      startPoint: { x: number; y: number };
      startCoords: Array<{ x: number; y: number; z: number }>;
    }
  | {
      kind: 'vertex-plan';
      vertexIndex: number;
      planeElevationM: number;
      startPoint: { x: number; y: number };
      startCoord: { x: number; y: number; z: number };
      startCoords: Array<{ x: number; y: number; z: number }>;
      /** Elements sharing the grabbed vertex; resolved once at drag start. */
      excludedElementIds: Set<string>;
    }
  | {
      kind: 'element-elevation';
      startClientY: number;
      startValueM: number;
      startCoords: Array<{ x: number; y: number; z: number }>;
      mode: Geometry3DElevationMode;
    }
  | {
      kind: 'element-pitch';
      startClientY: number;
      startValueDeg: number;
    }
  | {
      kind: 'vertex-elevation';
      vertexIndex: number;
      startClientY: number;
      startCoord: { x: number; y: number; z: number };
    };

type Geometry3DEditPreviewElementsById = Record<string, Element>;
type SetGeometry3DEditPreviewElements = React.Dispatch<React.SetStateAction<Geometry3DEditPreviewElementsById | null>>;

type Geometry3DDragFeedback = {
  modelXY: { x: number; y: number };
  elevationM: number;
  text: string;
};

type Geometry3DSnapMarker = {
  modelXY: { x: number; y: number };
  elevationM: number;
};

function pickPreviewElements(
  elementsById: Record<string, Element>,
  elementIds: Iterable<string>,
): Geometry3DEditPreviewElementsById {
  const previewElementsById: Geometry3DEditPreviewElementsById = {};
  for (const elementId of elementIds) {
    const element = elementsById[elementId];
    if (element) {
      previewElementsById[elementId] = element;
    }
  }
  return previewElementsById;
}

function buildElementPreview(
  elementsById: Record<string, Element>,
  element: Element,
  updates: Partial<Element>,
  floors: Floor[],
): Geometry3DEditPreviewElementsById {
  const directElementsById = {
    ...elementsById,
    [element.id]: {
      ...element,
      ...updates,
    } as Element,
  };
  const cascaded = cascadeHostedDescendantGeometry({
    previousElementsById: elementsById,
    nextElementsById: directElementsById,
    changedElementIds: [element.id],
    floors,
  });
  const translated = cascadeHostedDescendantTranslation({
    previousElementsById: elementsById,
    nextElementsById: cascaded.elementsById,
    changedElementIds: [element.id],
  });
  return pickPreviewElements(translated.elementsById, new Set([
    ...cascaded.changedElementIds,
    ...translated.changedElementIds,
  ]));
}

function buildVertexPreviewElements(
  elementsById: Record<string, Element>,
  updates: Array<{ elementId: string; vertexIndex: number; newPosition: { x: number; y: number; z: number } }>,
  floors: Floor[],
): Geometry3DEditPreviewElementsById {
  const directElementsById = { ...elementsById };
  const changedElementIds = new Set<string>();

  for (const { elementId, vertexIndex, newPosition } of updates) {
    const sourceElement = directElementsById[elementId];
    if (!sourceElement?.coordinates || vertexIndex < 0 || vertexIndex >= sourceElement.coordinates.length) continue;
    const coordinates = [...sourceElement.coordinates];
    coordinates[vertexIndex] = {
      ...coordinates[vertexIndex],
      ...newPosition,
    };
    directElementsById[elementId] = {
      ...sourceElement,
      coordinates,
    } as Element;
    changedElementIds.add(elementId);
  }

  const cascaded = cascadeHostedDescendantGeometry({
    previousElementsById: elementsById,
    nextElementsById: directElementsById,
    changedElementIds,
    floors,
  });
  return pickPreviewElements(cascaded.elementsById, cascaded.changedElementIds);
}

function roundEditMetres(value: number): number {
  return roundToTwoDecimals(value);
}

function roundEditDegrees(value: number): number {
  return roundToTwoDecimals(Math.min(89, Math.max(1, value)));
}

function formatEditMetres(value: number): string {
  return `${value.toFixed(2)} m`;
}

function formatPlanMoveFeedback(dx: number, dy: number): string {
  return `move ${formatEditMetres(Math.hypot(dx, dy))}`;
}

function formatPlanPointMoveFeedback(
  start: { x: number; y: number },
  next: { x: number; y: number },
): string {
  return formatPlanMoveFeedback(next.x - start.x, next.y - start.y);
}

function formatElevationFeedback(mode: Geometry3DElevationMode, valueM: number): string {
  if (mode === 'unheated-pitched-roof-ceiling') return `ceiling ${formatEditMetres(valueM)}`;
  if (mode === 'coordinates-z') return `elev ${formatEditMetres(valueM)}`;
  return `base ${formatEditMetres(valueM)}`;
}

function averageModelXY(coords: Array<{ x: number; y: number }>): { x: number; y: number } | null {
  if (coords.length === 0) return null;
  const sum = coords.reduce((acc, coord) => ({
    x: acc.x + coord.x,
    y: acc.y + coord.y,
  }), { x: 0, y: 0 });
  return {
    x: sum.x / coords.length,
    y: sum.y / coords.length,
  };
}

function eventPlanPointAtElevation(event: Geometry3DEditPointerEvent, elevationM: number): { x: number; y: number } | null {
  if (!event.ray) return null;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevationM);
  const hit = new THREE.Vector3();
  if (!event.ray.intersectPlane(plane, hit)) return null;
  return { x: hit.x, y: -hit.z };
}

function captureEditPointer(event: Geometry3DEditPointerEvent) {
  event.stopPropagation();
  if (event.pointerId !== undefined) {
    event.target?.setPointerCapture?.(event.pointerId);
  }
}

function releaseEditPointer(event: Geometry3DEditPointerEvent) {
  event.stopPropagation();
  if (event.pointerId !== undefined) {
    event.target?.releasePointerCapture?.(event.pointerId);
  }
}

/**
 * Unlike the 2D vertex-drag snap (`ElementRenderer.findCornerVertexSnapTarget`), this does not
 * gate candidates by storey: `excludedElementIds` (built by `excludedElementIdsForVertex`)
 * already excludes the dragged element plus every element sharing the exact source vertex
 * coordinates, and the 3D edit view has no established need for a same-floor guard beyond that.
 * Kept as an explicit divergence rather than silently unified with the 2D behaviour.
 */
function snap3DPlanPoint(
  point: { x: number; y: number },
  snapCache: GeometrySnapCache | undefined,
  snapTol: number,
  excludedElementIds: Set<string>,
): { x: number; y: number; snapped: boolean } {
  if (!snapCache) return { ...point, snapped: false };
  const best = findClosestSnapCorner(point, snapCache, snapTol, {
    isExcluded: (target) => excludedElementIds.has(target.elementId),
  });
  return best ? { x: best.x, y: best.y, snapped: true } : { ...point, snapped: false };
}

const Geometry3DEditHandles: React.FC<{
  element: Element;
  model: Geometry3DEditHandleModel;
  elementsById: Record<string, Element>;
  snapCache?: GeometrySnapCache;
  snapTol: number;
  snapCorners: boolean;
  updateElement: (id: string, updates: Partial<Element>, skipAutoSave?: boolean) => void;
  commitVertexPositionUpdates: (
    updates: Array<{ elementId: string; vertexIndex: number; newPosition: { x: number; y: number; z: number } }>,
    skipAutoSave?: boolean,
  ) => void;
  setEditDragging: (dragging: boolean) => void;
  setPreviewElementsById: SetGeometry3DEditPreviewElements;
  floors: Floor[];
}> = ({
  element,
  model,
  elementsById,
  snapCache,
  snapTol,
  snapCorners,
  updateElement,
  commitVertexPositionUpdates,
  setEditDragging,
  setPreviewElementsById,
  floors,
}) => {
  const dragSessionRef = useRef<Geometry3DDragSession | null>(null);
  const pendingPreviewRef = useRef<Geometry3DEditPreviewElementsById | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const [snapActive, setSnapActive] = useState(false);
  const [snapMarker, setSnapMarker] = useState<Geometry3DSnapMarker | null>(null);
  const [dragFeedback, setDragFeedback] = useState<Geometry3DDragFeedback | null>(null);

  const publishPreview = useCallback((previewElementsById: Geometry3DEditPreviewElementsById) => {
    pendingPreviewRef.current = previewElementsById;
    if (typeof window === 'undefined') {
      setPreviewElementsById(previewElementsById);
      return;
    }
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null;
      setPreviewElementsById(pendingPreviewRef.current);
    });
  }, [setPreviewElementsById]);

  const clearPreview = useCallback(() => {
    pendingPreviewRef.current = null;
    if (previewFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    setPreviewElementsById(null);
  }, [setPreviewElementsById]);

  useEffect(() => clearPreview, [clearPreview]);

  const excludedElementIdsForVertex = useCallback((vertexIndex: number) => {
    const ids = new Set<string>([element.id]);
    const source = element.coordinates?.[vertexIndex];
    if (!source) return ids;
    for (const candidate of Object.values(elementsById)) {
      const coords = candidate?.coordinates ?? [];
      if (coords.some((coord) => coord.x === source.x && coord.y === source.y && coord.z === source.z)) {
        ids.add(candidate.id);
      }
    }
    return ids;
  }, [element, elementsById]);

  const applyVertexPlan = useCallback((vertexIndex: number, next: { x: number; y: number; z: number }, skipAutoSave: boolean) => {
    const updates = buildSharedVertexPositionUpdates(elementsById, element.id, vertexIndex, next, 'plan');
    if (updates.length === 0) return;
    if (skipAutoSave) {
      publishPreview(buildVertexPreviewElements(elementsById, updates, floors));
      return;
    }
    commitVertexPositionUpdates(updates, skipAutoSave);
  }, [commitVertexPositionUpdates, element.id, elementsById, floors, publishPreview]);

  const projectParentConstrainedCoords = useCallback((coords: Array<{ x: number; y: number; z: number }>) => (
    projectParentConstrainedLineCoordinates(element, coords, elementsById)
  ), [element, elementsById]);

  const applyParentConstrainedVertexPlan = useCallback((
    vertexIndex: number,
    startCoords: Array<{ x: number; y: number; z: number }>,
    next: { x: number; y: number; z: number },
    skipAutoSave: boolean,
  ) => {
    const coords = startCoords.map((coord, index) => (
      index === vertexIndex
        ? { ...coord, x: next.x, y: next.y }
        : { ...coord }
    ));
    const projectedCoords = projectParentConstrainedCoords(coords);
    if (skipAutoSave) {
      publishPreview(buildElementPreview(elementsById, element, { coordinates: projectedCoords } as Partial<Element>, floors));
      return;
    }
    updateElement(element.id, { coordinates: projectedCoords } as Partial<Element>, skipAutoSave);
  }, [element, elementsById, floors, projectParentConstrainedCoords, publishPreview, updateElement]);

  const applyVertexElevation = useCallback((vertexIndex: number, next: { x: number; y: number; z: number }, skipAutoSave: boolean) => {
    const updates = buildSharedVertexPositionUpdates(elementsById, element.id, vertexIndex, next, 'elevation');
    if (updates.length === 0) return;
    if (skipAutoSave) {
      publishPreview(buildVertexPreviewElements(elementsById, updates, floors));
      return;
    }
    commitVertexPositionUpdates(updates, skipAutoSave);
  }, [commitVertexPositionUpdates, element.id, elementsById, floors, publishPreview]);

  const applyElementPlan = useCallback((coords: Array<{ x: number; y: number; z: number }>, skipAutoSave: boolean) => {
    const nextCoords = projectParentConstrainedCoords(coords);
    if (skipAutoSave) {
      publishPreview(buildElementPreview(elementsById, element, { coordinates: nextCoords } as Partial<Element>, floors));
      return;
    }
    updateElement(element.id, { coordinates: nextCoords } as Partial<Element>, skipAutoSave);
  }, [element, elementsById, floors, projectParentConstrainedCoords, publishPreview, updateElement]);

  const applyElementElevation = useCallback((
    mode: Geometry3DElevationMode,
    valueM: number,
    startCoords: Array<{ x: number; y: number; z: number }>,
    skipAutoSave: boolean,
  ) => {
    if (mode === 'coordinates-z') {
      const delta = valueM - (startCoords.length > 0
        ? startCoords.reduce((sum, coord) => sum + coord.z, 0) / startCoords.length
        : valueM);
      const coordinates = startCoords.map((coord) => ({
        ...coord,
        z: roundEditMetres(coord.z + delta),
      }));
      if (skipAutoSave) {
        publishPreview(buildElementPreview(elementsById, element, { coordinates } as Partial<Element>, floors));
      } else {
        updateElement(
          element.id,
          { coordinates } as Partial<Element>,
          skipAutoSave,
        );
      }
      return;
    }
    if (mode === 'unheated-pitched-roof-ceiling') {
      const extra_json = mergeUnheatedPitchedRoofCeilingElevationExtraJson(
        (element as { extra_json?: unknown }).extra_json,
        roundEditMetres(valueM),
      );
      if (skipAutoSave) {
        publishPreview(buildElementPreview(elementsById, element, { extra_json } as Partial<Element>, floors));
        return;
      }
      updateElement(element.id, { extra_json } as Partial<Element>, skipAutoSave);
      return;
    }
    if (skipAutoSave) {
      publishPreview(buildElementPreview(elementsById, element, { [mode]: roundEditMetres(valueM) } as Partial<Element>, floors));
      return;
    }
    updateElement(
      element.id,
      { [mode]: roundEditMetres(valueM) } as Partial<Element>,
      skipAutoSave,
    );
  }, [element, elementsById, floors, publishPreview, updateElement]);

  const applyElementPitch = useCallback((valueDeg: number, skipAutoSave: boolean) => {
    const pitch = roundEditDegrees(valueDeg);
    if (skipAutoSave) {
      publishPreview(buildElementPreview(elementsById, element, { pitch } as Partial<Element>, floors));
      return;
    }
    updateElement(element.id, { pitch } as Partial<Element>, skipAutoSave);
  }, [element, elementsById, floors, publishPreview, updateElement]);

  const finishDrag = useCallback((event: Geometry3DEditPointerEvent) => {
    const session = dragSessionRef.current;
    if (!session) return;
    dragSessionRef.current = null;
    setEditDragging(false);
    setSnapActive(false);
    setSnapMarker(null);
    setDragFeedback(null);
    releaseEditPointer(event);

    if (session.kind === 'element-plan') {
      const point = eventPlanPointAtElevation(event, model.planHandleElevationM);
      if (!point) {
        clearPreview();
        return;
      }
      const dx = point.x - session.startPoint.x;
      const dy = point.y - session.startPoint.y;
      let coords = session.startCoords.map((coord) => ({
        ...coord,
        x: roundEditMetres(coord.x + dx),
        y: roundEditMetres(coord.y + dy),
      }));
      if (!isParentConstrainedLineElement(element) && snapCorners && snapCache) {
        // Match the drag preview: translate the whole shape rather than snapping each vertex
        // independently, which would resize the element on release.
        coords = translateShapeToSnapFromCache(element, coords, snapCache, () => snapTol).coords;
      }
      applyElementPlan(coords, false);
      clearPreview();
      return;
    }

    if (session.kind === 'vertex-plan') {
      const point = eventPlanPointAtElevation(event, session.planeElevationM);
      if (!point) {
        clearPreview();
        return;
      }
      const dx = point.x - session.startPoint.x;
      const dy = point.y - session.startPoint.y;
      let next = {
        ...session.startCoord,
        x: roundEditMetres(session.startCoord.x + dx),
        y: roundEditMetres(session.startCoord.y + dy),
      };
      if (snapCorners) {
        const snapped = snap3DPlanPoint(
          { x: next.x, y: next.y },
          snapCache,
          snapTol,
          session.excludedElementIds,
        );
        next = { ...next, x: snapped.x, y: snapped.y };
      }
      if (isParentConstrainedLineElement(element)) {
        applyParentConstrainedVertexPlan(session.vertexIndex, session.startCoords, next, false);
        clearPreview();
        return;
      }
      applyVertexPlan(session.vertexIndex, next, false);
      clearPreview();
      return;
    }

    if (session.kind === 'element-elevation') {
      const clientY = event.clientY ?? session.startClientY;
      const nextElevation = roundEditMetres(session.startValueM - ((clientY - session.startClientY) * EDIT_HANDLE_ELEVATION_PX_TO_M));
      applyElementElevation(session.mode, nextElevation, session.startCoords, false);
      clearPreview();
      return;
    }

    if (session.kind === 'element-pitch') {
      const clientY = event.clientY ?? session.startClientY;
      const nextPitch = roundEditDegrees(session.startValueDeg - ((clientY - session.startClientY) * EDIT_HANDLE_PITCH_PX_TO_DEG));
      applyElementPitch(nextPitch, false);
      clearPreview();
      return;
    }

    {
      const clientY = event.clientY ?? session.startClientY;
      const nextElevation = roundEditMetres(session.startCoord.z - ((clientY - session.startClientY) * EDIT_HANDLE_ELEVATION_PX_TO_M));
      applyVertexElevation(
        session.vertexIndex,
        { ...session.startCoord, z: nextElevation },
        false,
      );
    }
    clearPreview();
  }, [
    applyElementElevation,
    applyElementPlan,
    applyElementPitch,
    applyParentConstrainedVertexPlan,
    applyVertexElevation,
    applyVertexPlan,
    clearPreview,
    element,
    model.planHandleElevationM,
    setEditDragging,
    snapCache,
    snapCorners,
    snapTol,
  ]);

  const handlePointerMove = useCallback((event: Geometry3DEditPointerEvent) => {
    const session = dragSessionRef.current;
    if (!session) return;
    event.stopPropagation();

    if (session.kind === 'element-plan') {
      const point = eventPlanPointAtElevation(event, model.planHandleElevationM);
      if (!point) return;
      const dx = point.x - session.startPoint.x;
      const dy = point.y - session.startPoint.y;
      let coords = session.startCoords.map((coord) => ({
        ...coord,
        x: roundEditMetres(coord.x + dx),
        y: roundEditMetres(coord.y + dy),
      }));
      if (snapCorners && snapCache) {
        if (isParentConstrainedLineElement(element)) {
          setSnapActive(true);
          setSnapMarker(null);
        } else {
          const snapped = translateShapeToSnapFromCache(element, coords, snapCache, () => snapTol);
          coords = snapped.coords;
          const snappedCoord = snapped.snappedIndex !== null ? coords[snapped.snappedIndex] : null;
          setSnapActive(snappedCoord !== null);
          setSnapMarker(snappedCoord
            ? {
                modelXY: { x: snappedCoord.x, y: snappedCoord.y },
                elevationM: model.planHandleElevationM,
              }
            : null);
        }
      } else {
        setSnapActive(isParentConstrainedLineElement(element));
        setSnapMarker(null);
      }
      const constrainedCoords = isParentConstrainedLineElement(element)
        ? projectParentConstrainedCoords(coords)
        : coords;
      const startCenter = averageModelXY(session.startCoords);
      const nextCenter = averageModelXY(constrainedCoords) ?? model.modelCenter;
      setDragFeedback({
        modelXY: nextCenter,
        elevationM: model.planHandleElevationM + EDIT_HANDLE_DRAG_LABEL_OFFSET_M,
        text: startCenter
          ? formatPlanMoveFeedback(nextCenter.x - startCenter.x, nextCenter.y - startCenter.y)
          : formatPlanMoveFeedback(dx, dy),
      });
      applyElementPlan(coords, true);
      return;
    }

    if (session.kind === 'vertex-plan') {
      const point = eventPlanPointAtElevation(event, session.planeElevationM);
      if (!point) return;
      const dx = point.x - session.startPoint.x;
      const dy = point.y - session.startPoint.y;
      let next = {
        ...session.startCoord,
        x: roundEditMetres(session.startCoord.x + dx),
        y: roundEditMetres(session.startCoord.y + dy),
      };
      let feedbackPoint = next;
      if (snapCorners) {
        const snapped = snap3DPlanPoint(
          { x: next.x, y: next.y },
          snapCache,
          snapTol,
          session.excludedElementIds,
        );
        next = { ...next, x: snapped.x, y: snapped.y };
        setSnapActive(snapped.snapped);
        setSnapMarker(snapped.snapped
          ? {
              modelXY: { x: snapped.x, y: snapped.y },
              elevationM: session.planeElevationM,
            }
          : null);
      } else {
        setSnapActive(isParentConstrainedLineElement(element));
        setSnapMarker(null);
      }
      if (isParentConstrainedLineElement(element)) {
        const coords = session.startCoords.map((coord, index) => (
          index === session.vertexIndex
            ? { ...coord, x: next.x, y: next.y }
            : { ...coord }
        ));
        feedbackPoint = projectParentConstrainedCoords(coords)[session.vertexIndex] ?? next;
        applyParentConstrainedVertexPlan(session.vertexIndex, session.startCoords, next, true);
        setSnapActive(true);
      } else {
        applyVertexPlan(session.vertexIndex, next, true);
      }
      setDragFeedback({
        modelXY: { x: feedbackPoint.x, y: feedbackPoint.y },
        elevationM: session.planeElevationM + EDIT_HANDLE_DRAG_LABEL_OFFSET_M,
        text: formatPlanPointMoveFeedback(session.startCoord, feedbackPoint),
      });
      return;
    }

    setSnapActive(false);
    setSnapMarker(null);
    if (session.kind === 'element-elevation') {
      const clientY = event.clientY ?? session.startClientY;
      const nextElevation = roundEditMetres(session.startValueM - ((clientY - session.startClientY) * EDIT_HANDLE_ELEVATION_PX_TO_M));
      const handle = session.mode === 'unheated-pitched-roof-ceiling'
        ? model.ceilingElevationHandle
        : model.elementElevationHandle;
      if (handle) {
        setDragFeedback({
          modelXY: handle.modelXY,
          elevationM: Math.max(handle.capElevationM, nextElevation) + EDIT_HANDLE_DRAG_LABEL_OFFSET_M,
          text: formatElevationFeedback(session.mode, nextElevation),
        });
      }
      applyElementElevation(session.mode, nextElevation, session.startCoords, true);
      return;
    }

    if (session.kind === 'element-pitch') {
      const clientY = event.clientY ?? session.startClientY;
      const nextPitch = roundEditDegrees(session.startValueDeg - ((clientY - session.startClientY) * EDIT_HANDLE_PITCH_PX_TO_DEG));
      if (model.pitchHandle) {
        setDragFeedback({
          modelXY: model.pitchHandle.modelXY,
          elevationM: model.pitchHandle.elevationM + EDIT_HANDLE_DRAG_LABEL_OFFSET_M,
          text: `pitch ${nextPitch.toFixed(1)} deg`,
        });
      }
      applyElementPitch(nextPitch, true);
      return;
    }

    {
      const clientY = event.clientY ?? session.startClientY;
      const nextElevation = roundEditMetres(session.startCoord.z - ((clientY - session.startClientY) * EDIT_HANDLE_ELEVATION_PX_TO_M));
      const handle = model.vertexHandles.find((candidate) => candidate.vertexIndex === session.vertexIndex);
      setDragFeedback({
        modelXY: handle?.modelXY ?? { x: session.startCoord.x, y: session.startCoord.y },
        elevationM: nextElevation + EDIT_HANDLE_DRAG_LABEL_OFFSET_M,
        text: `elev ${formatEditMetres(nextElevation)}`,
      });
      applyVertexElevation(
        session.vertexIndex,
        { ...session.startCoord, z: nextElevation },
        true,
      );
    }
  }, [
    applyElementElevation,
    applyElementPlan,
    applyElementPitch,
    applyParentConstrainedVertexPlan,
    applyVertexElevation,
    applyVertexPlan,
    element,
    model,
    projectParentConstrainedCoords,
    snapCache,
    snapCorners,
    snapTol,
  ]);

  const startElementPlanDrag = useCallback((event: Geometry3DEditPointerEvent) => {
    const point = eventPlanPointAtElevation(event, model.planHandleElevationM);
    if (!point) return;
    clearPreview();
    setSnapActive(false);
    setSnapMarker(null);
    setDragFeedback(null);
    captureEditPointer(event);
    dragSessionRef.current = {
      kind: 'element-plan',
      startPoint: point,
      startCoords: [...(element.coordinates ?? [])],
    };
    setEditDragging(true);
  }, [clearPreview, element.coordinates, model.planHandleElevationM, setEditDragging]);

  const startVertexPlanDrag = useCallback((handle: Geometry3DEditVertexHandle) => (event: Geometry3DEditPointerEvent) => {
    const startCoord = element.coordinates?.[handle.vertexIndex];
    if (!startCoord) return;
    const point = eventPlanPointAtElevation(event, handle.handleElevationM);
    if (!point) return;
    clearPreview();
    setSnapActive(false);
    setSnapMarker(null);
    setDragFeedback(null);
    captureEditPointer(event);
    dragSessionRef.current = {
      kind: 'vertex-plan',
      vertexIndex: handle.vertexIndex,
      planeElevationM: handle.handleElevationM,
      startPoint: point,
      startCoord: { ...startCoord },
      startCoords: [...(element.coordinates ?? [])],
      excludedElementIds: excludedElementIdsForVertex(handle.vertexIndex),
    };
    setEditDragging(true);
  }, [clearPreview, element.coordinates, excludedElementIdsForVertex, setEditDragging]);

  const startElementElevationDrag = useCallback((handle: Geometry3DEditElevationHandle) => (event: Geometry3DEditPointerEvent) => {
    clearPreview();
    setSnapActive(false);
    setSnapMarker(null);
    setDragFeedback(null);
    captureEditPointer(event);
    dragSessionRef.current = {
      kind: 'element-elevation',
      startClientY: event.clientY ?? 0,
      startValueM: handle.valueM,
      startCoords: [...(element.coordinates ?? [])],
      mode: handle.mode,
    };
    setEditDragging(true);
  }, [clearPreview, element.coordinates, setEditDragging]);

  const startPitchDrag = useCallback((handle: Geometry3DEditPitchHandle) => (event: Geometry3DEditPointerEvent) => {
    clearPreview();
    setSnapActive(false);
    setSnapMarker(null);
    setDragFeedback(null);
    captureEditPointer(event);
    dragSessionRef.current = {
      kind: 'element-pitch',
      startClientY: event.clientY ?? 0,
      startValueDeg: handle.valueDeg,
    };
    setEditDragging(true);
  }, [clearPreview, setEditDragging]);

  const startVertexElevationDrag = useCallback((handle: Geometry3DEditVertexHandle) => (event: Geometry3DEditPointerEvent) => {
    const startCoord = element.coordinates?.[handle.vertexIndex];
    if (!startCoord) return;
    clearPreview();
    setSnapActive(false);
    setSnapMarker(null);
    setDragFeedback(null);
    captureEditPointer(event);
    dragSessionRef.current = {
      kind: 'vertex-elevation',
      vertexIndex: handle.vertexIndex,
      startClientY: event.clientY ?? 0,
      startCoord: { ...startCoord },
    };
    setEditDragging(true);
  }, [clearPreview, element.coordinates, setEditDragging]);

  const centerPosition = useMemo(() => {
    const [x, z] = modelXYToThreeXZ([model.modelCenter.x, model.modelCenter.y]);
    return [x, model.planHandleElevationM, z] as [number, number, number];
  }, [model.modelCenter.x, model.modelCenter.y, model.planHandleElevationM]);
  // `readRootCssVar` runs `getComputedStyle(document.documentElement)`; resolve once per render
  // instead of once per vertex handle.
  const snapColor = readRootCssVar('--semantic-snap', '#1E90FF');
  const handleColor = snapActive
    ? snapColor
    : readRootCssVar('--canvas-3d-edit-handle', '#facc15');
  const handleStrokeColor = readRootCssVar('--canvas-3d-edit-handle-stroke', '#111827');
  const elevationColor = readRootCssVar('--canvas-3d-edit-elevation', '#22d3ee');
  const pitchColor = readRootCssVar('--canvas-3d-edit-pitch', '#f97316');

  return (
    <group>
      <mesh
        position={centerPosition}
        onPointerDown={startElementPlanDrag}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        renderOrder={1000}
      >
        <sphereGeometry args={[EDIT_HANDLE_CENTER_RADIUS_M, 24, 16]} />
        <meshBasicMaterial color={handleColor} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>

      {model.vertexHandles.map((handle) => {
        const [x, z] = modelXYToThreeXZ([handle.modelXY.x, handle.modelXY.y]);
        const connected = handle.connectedCount > 1;
        return (
          <group key={`edit-vertex-${handle.elementId}-${handle.vertexIndex}`}>
            <mesh
              position={[x, handle.handleElevationM, z]}
              onPointerDown={startVertexPlanDrag(handle)}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              renderOrder={1001}
            >
              <boxGeometry args={[EDIT_HANDLE_ENDPOINT_SIZE_M, EDIT_HANDLE_ENDPOINT_SIZE_M, EDIT_HANDLE_ENDPOINT_SIZE_M]} />
              <meshBasicMaterial
                color={connected ? snapColor : handleColor}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            {handle.supportsElevation ? (
              <ElevationHandle
                modelXY={handle.modelXY}
                stemBaseElevationM={handle.handleElevationM + 0.16}
                capElevationM={handle.handleElevationM + 0.58}
                color={elevationColor}
                strokeColor={handleStrokeColor}
                onPointerDown={startVertexElevationDrag(handle)}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
              />
            ) : null}
          </group>
        );
      })}

      {model.elementElevationHandle ? (
        <ElevationHandle
          modelXY={model.elementElevationHandle.modelXY}
          stemBaseElevationM={model.elementElevationHandle.stemBaseElevationM}
          capElevationM={model.elementElevationHandle.capElevationM}
          color={elevationColor}
          strokeColor={handleStrokeColor}
          onPointerDown={startElementElevationDrag(model.elementElevationHandle)}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
        />
      ) : null}

      {model.ceilingElevationHandle ? (
        <ElevationHandle
          modelXY={model.ceilingElevationHandle.modelXY}
          stemBaseElevationM={model.ceilingElevationHandle.stemBaseElevationM}
          capElevationM={model.ceilingElevationHandle.capElevationM}
          color={elevationColor}
          strokeColor={handleStrokeColor}
          onPointerDown={startElementElevationDrag(model.ceilingElevationHandle)}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
        />
      ) : null}

      {model.pitchHandle ? (
        <PitchHandle
          handle={model.pitchHandle}
          color={pitchColor}
          strokeColor={handleStrokeColor}
          onPointerDown={startPitchDrag(model.pitchHandle)}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
        />
      ) : null}

      {snapMarker ? (
        <SnapTargetMarker
          marker={snapMarker}
          color={snapColor}
        />
      ) : null}

      {dragFeedback ? (
        <DragFeedbackLabel feedback={dragFeedback} />
      ) : null}
    </group>
  );
};

const SnapTargetMarker: React.FC<{
  marker: Geometry3DSnapMarker;
  color: string;
}> = ({ marker, color }) => {
  const [x, z] = modelXYToThreeXZ([marker.modelXY.x, marker.modelXY.y]);
  return (
    <mesh position={[x, marker.elevationM, z]} raycast={ignoreRaycast} renderOrder={1005}>
      <sphereGeometry args={[EDIT_HANDLE_SNAP_MARKER_RADIUS_M, 18, 10]} />
      <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} transparent opacity={0.96} />
    </mesh>
  );
};

const DragFeedbackLabel: React.FC<{
  feedback: Geometry3DDragFeedback;
}> = ({ feedback }) => {
  const [x, z] = modelXYToThreeXZ([feedback.modelXY.x, feedback.modelXY.y]);
  return (
    <Html position={[x, feedback.elevationM, z]} center style={{ pointerEvents: 'none' }}>
      <div className="geometry-canvas-3d-drag-feedback-label">
        {feedback.text}
      </div>
    </Html>
  );
};

const PitchHandle: React.FC<{
  handle: Geometry3DEditPitchHandle;
  color: string;
  strokeColor: string;
  onPointerDown: (event: Geometry3DEditPointerEvent) => void;
  onPointerMove: (event: Geometry3DEditPointerEvent) => void;
  onPointerUp: (event: Geometry3DEditPointerEvent) => void;
}> = ({
  handle,
  color,
  strokeColor,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) => {
  const [x, z] = modelXYToThreeXZ([handle.modelXY.x, handle.modelXY.y]);
  const [ex, ez] = modelXYToThreeXZ([handle.eavesModelXY.x, handle.eavesModelXY.y]);
  const handlePosition = [x, handle.elevationM, z] as [number, number, number];
  const eavesPosition = [ex, handle.eavesElevationM, ez] as [number, number, number];

  return (
    <group>
      <Line
        points={[eavesPosition, handlePosition]}
        color={color}
        lineWidth={1.5}
        transparent
        opacity={0.92}
        depthWrite={false}
        depthTest={false}
      />
      <mesh
        position={handlePosition}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        renderOrder={1003}
      >
        <sphereGeometry args={[EDIT_HANDLE_PITCH_RADIUS_M, 20, 12]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={eavesPosition} raycast={ignoreRaycast} renderOrder={1002}>
        <sphereGeometry args={[EDIT_HANDLE_ELEVATION_STEM_RADIUS_M * 1.8, 12, 8]} />
        <meshBasicMaterial color={strokeColor} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
};

const ElevationHandle: React.FC<{
  modelXY: { x: number; y: number };
  stemBaseElevationM: number;
  capElevationM: number;
  color: string;
  strokeColor: string;
  onPointerDown: (event: Geometry3DEditPointerEvent) => void;
  onPointerMove: (event: Geometry3DEditPointerEvent) => void;
  onPointerUp: (event: Geometry3DEditPointerEvent) => void;
}> = ({
  modelXY,
  stemBaseElevationM,
  capElevationM,
  color,
  strokeColor,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) => {
  const [x, z] = modelXYToThreeXZ([modelXY.x, modelXY.y]);
  const stemHeight = Math.max(0.05, capElevationM - stemBaseElevationM);
  const stemMidY = stemBaseElevationM + stemHeight / 2;
  return (
    <group>
      <mesh position={[x, stemMidY, z]} raycast={ignoreRaycast} renderOrder={1000}>
        <cylinderGeometry args={[EDIT_HANDLE_ELEVATION_STEM_RADIUS_M, EDIT_HANDLE_ELEVATION_STEM_RADIUS_M, stemHeight, 10]} />
        <meshBasicMaterial color={strokeColor} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh
        position={[x, capElevationM, z]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        renderOrder={1002}
      >
        <sphereGeometry args={[EDIT_HANDLE_ELEVATION_RADIUS_M, 20, 12]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
};

const PolygonPrismMesh: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'polygon-prism' }>;
  selected: boolean;
  showDetail: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, showDetail, onSelect, currentFloorZ, categoryGhost = false }) => {
  const isWindow = primitive.elementType === 'BuildingElementTransparent';
  const isOpening = primitive.isOpening;
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const matDim = materialDimForCategoryGhost(
    primitive.usesFallbackHeight
      ? meshStandardFloorDimmingPropsWithBaseOpacity(
        primitive.isCurrentFloor,
        FALLBACK_HEIGHT_WALL_OPACITY,
        isAboveCurrentFloor,
      )
      : meshStandardFloorDimmingProps(primitive.isCurrentFloor, isAboveCurrentFloor),
    categoryGhost,
  );
  const openingKind: 'window' | 'door' | null = isOpening
    ? (isWindow ? 'window' : 'door')
    : null;
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, isOpening);

  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    // Important: shape points are in pre-rotation shape space; do not mirror Y here.
    const points = primitive.points.map(modelXYToExtrudeShapeXY);
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
    shape.closePath();

    const extruded = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(primitive.heightM, 0.02),
      bevelEnabled: false,
      steps: 1,
    });
    extruded.rotateX(-Math.PI / 2);
    extruded.translate(0, primitive.baseElevationM, 0);
    extruded.computeVertexNormals();

    return extruded;
  }, [primitive]);

  const emissiveProps = openingKind
    ? openingEmissive(openingKind, primitive.isCurrentFloor)
    : { emissive: '#000000', emissiveIntensity: 0 };

  return (
    <group visible={!categoryGhost}>
      <mesh
        geometry={geometry}
        onClick={isInteractive ? ((event) => {
          event.stopPropagation();
          onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
        }) : undefined}
        {...hoverHandlers}
        raycast={meshRaycastForInteractivity(isInteractive)}
        castShadow={!isAboveCurrentFloor}
        receiveShadow={!isAboveCurrentFloor}
        renderOrder={renderOrder}
      >
        <meshStandardMaterial
          color={displayColor}
          metalness={isWindow ? 0.02 : 0.08}
          roughness={isWindow ? 0.22 : 0.7}
          {...emissiveProps}
          toneMapped
          polygonOffset={Boolean(isOpening)}
          polygonOffsetFactor={isOpening ? OPENING_POLYGON_OFFSET.factor : 0}
          polygonOffsetUnits={isOpening ? OPENING_POLYGON_OFFSET.units : 0}
          {...matDim}
        />
        {isOpening && openingKind && !isAboveCurrentFloor ? (
          <Edges
            color={floorDimmedMeshColor(openingEdgeColor(openingKind), primitive.isCurrentFloor)}
            threshold={12}
            lineWidth={1}
          />
        ) : null}
      </mesh>
      {primitive.usesFallbackHeight ? (
        <Line
          points={[
            [primitive.points[0][0], primitive.baseElevationM + primitive.heightM, primitive.points[0][1]],
            ...primitive.points.slice(1).map(([x, y]) => [x, primitive.baseElevationM + primitive.heightM, y] as [number, number, number]),
            [primitive.points[0][0], primitive.baseElevationM + primitive.heightM, primitive.points[0][1]],
          ].map(([x, elevation, y]) => {
            const [tx, tz] = modelXYToThreeXZ([x, y]);
            return [tx, elevation, tz] as [number, number, number];
          })}
          color={floorDimmedMeshColor(readRootCssVar('--canvas-3d-fallback-edge', '#64748b'), primitive.isCurrentFloor)}
          lineWidth={1.2}
          dashed
          dashSize={0.18}
          gapSize={0.1}
          raycast={ignoreRaycast}
        />
      ) : null}
      {selected && !categoryGhost ? (
        <mesh
          geometry={geometry}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <SelectionOverlayMaterial />
        </mesh>
      ) : null}
      {showHoverHalo ? (
        <mesh
          geometry={geometry}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <HoverOverlayMaterial />
        </mesh>
      ) : null}
      <PolygonPrismWindowVentilationOverlays primitive={primitive} showDetail={showDetail} />
    </group>
  );
};

const PolygonSlopedMesh: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'polygon-sloped' }>;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, onSelect, currentFloorZ, categoryGhost = false }) => {
  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const opacity = primitive.opacity ?? 1;
  const hasExplicitTransparency = primitive.opacity !== undefined && opacity < 1;
  const matDim = materialDimForCategoryGhost(
    hasExplicitTransparency
      ? meshStandardFloorDimmingPropsWithBaseOpacity(
          primitive.isCurrentFloor,
          opacity,
          isAboveCurrentFloor,
        )
      : meshStandardFloorDimmingProps(primitive.isCurrentFloor, isAboveCurrentFloor),
    categoryGhost,
  );
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, primitive.isOpening);
  const geometry = useMemo(() => {
    return buildSlopedPolygonBufferGeometry(
      primitive.points,
      primitive.hingeAnchorXY,
      primitive.inwardNormal2D,
      primitive.baseElevationM,
      primitive.pitchDeg,
      primitive.thicknessM,
    );
  }, [primitive]);

  return (
    <mesh
      visible={!categoryGhost}
      geometry={geometry}
      onClick={isInteractive ? ((event) => {
        event.stopPropagation();
        onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
      }) : undefined}
      {...hoverHandlers}
      raycast={meshRaycastForInteractivity(isInteractive)}
      castShadow={!isAboveCurrentFloor && !hasExplicitTransparency}
      receiveShadow={!isAboveCurrentFloor && !hasExplicitTransparency}
      renderOrder={renderOrder}
    >
      <meshStandardMaterial
        color={displayColor}
        metalness={0.08}
        roughness={0.7}
        emissive="#000000"
        emissiveIntensity={0}
        toneMapped
        side={THREE.DoubleSide}
        {...matDim}
        depthWrite={hasExplicitTransparency ? false : matDim.depthWrite}
      />
      {selected && !categoryGhost ? (
        <mesh
          geometry={geometry}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <SelectionOverlayMaterial doubleSided opacity={SELECTION_OVERLAY_OPACITY} />
        </mesh>
      ) : null}
      {showHoverHalo ? (
        <mesh
          geometry={geometry}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <HoverOverlayMaterial doubleSided />
        </mesh>
      ) : null}
    </mesh>
  );
};

const PlanarFaceMesh: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'planar-face' }>;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, onSelect, currentFloorZ, categoryGhost = false }) => {
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const hasThickness = primitive.thicknessM !== undefined;
  const geometry = useMemo(
    () => buildPlanarFaceGeometry(primitive.points, primitive.thicknessM),
    [primitive.points, primitive.thicknessM],
  );
  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const isOpening = primitive.isOpening;
  // Wall-style dimming (opaque off-floor, wireframe above) is only for solid OPAQUE faces;
  // profiled openings carry thickness too (they must protrude beyond the host wall's prism)
  // but keep their translucent glass treatment and base-opacity dimming.
  const isSolidWallFace = hasThickness && !isOpening;
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, isOpening);
  const opacity = primitive.opacity ?? (isOpening ? (primitive.isCurrentFloor ? 0.72 : 0.28) : 1);
  const hasExplicitTransparency = !isSolidWallFace && primitive.opacity !== undefined && opacity < 1;
  const dim = materialDimForCategoryGhost(
    planarFaceFloorDimmingProps(isSolidWallFace, primitive.isCurrentFloor, opacity, isAboveCurrentFloor),
    categoryGhost,
  );

  return (
    <mesh
      visible={!categoryGhost}
      geometry={geometry}
      onClick={isInteractive ? ((event) => {
        event.stopPropagation();
        onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
      }) : undefined}
      {...hoverHandlers}
      raycast={meshRaycastForInteractivity(isInteractive)}
      castShadow={!isAboveCurrentFloor && !isOpening && !hasExplicitTransparency}
      receiveShadow={!isAboveCurrentFloor && !hasExplicitTransparency}
      renderOrder={renderOrder}
    >
      <meshStandardMaterial
        color={displayColor}
        metalness={isOpening ? 0.02 : 0.08}
        roughness={isOpening ? 0.2 : 0.7}
        emissive={isOpening ? readRootCssVar('--canvas-3d-window-emissive', '#153a5c') : '#000000'}
        emissiveIntensity={isOpening ? 0.35 : 0}
        side={THREE.DoubleSide}
        transparent={dim.transparent}
        opacity={dim.opacity}
        depthWrite={isOpening || hasExplicitTransparency ? false : dim.depthWrite}
        wireframe={dim.wireframe}
      />
      {selected && !categoryGhost ? (
        <mesh
          geometry={geometry}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <SelectionOverlayMaterial
            doubleSided
            opacity={isOpening ? Math.min(0.4, SELECTION_OVERLAY_OPACITY) : SELECTION_OVERLAY_OPACITY}
          />
        </mesh>
      ) : null}
      {showHoverHalo ? (
        <mesh
          geometry={geometry}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <HoverOverlayMaterial
            doubleSided
            opacity={isOpening ? Math.min(0.32, HOVER_OVERLAY_OPACITY) : HOVER_OVERLAY_OPACITY}
          />
        </mesh>
      ) : null}
    </mesh>
  );
};

/** Horizontal `ThermalBridgeLinear`: cylinder axis along the segment (same radius as vertical jambs). */
const ThermalBridgeLinearHorizontalCylinder: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'wall-segment' }>;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, onSelect, currentFloorZ, ax, az, bx, bz, length, categoryGhost = false }) => {
  const depthLikeOpening = Boolean(primitive.renderAboveWallPlane);
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const matDim = materialDimForCategoryGhost(
    meshStandardFloorDimmingProps(primitive.isCurrentFloor, isAboveCurrentFloor),
    categoryGhost,
  );
  const cx = (ax + bx) / 2;
  const cz = (az + bz) / 2;
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, depthLikeOpening);

  const quat = useMemo(() => {
    const dir = new THREE.Vector3(bx - ax, 0, bz - az);
    if (dir.lengthSq() < 1e-12) return new THREE.Quaternion();
    dir.normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [ax, az, bx, bz]);

  return (
    <group visible={!categoryGhost}>
      <mesh
        position={[cx, primitive.baseElevationM + primitive.heightM / 2, cz]}
        quaternion={quat}
        onClick={isInteractive ? ((event) => {
          event.stopPropagation();
          onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
        }) : undefined}
        {...hoverHandlers}
        raycast={meshRaycastForInteractivity(isInteractive)}
        castShadow={!isAboveCurrentFloor}
        receiveShadow={!isAboveCurrentFloor}
        renderOrder={renderOrder}
      >
        <cylinderGeometry
          args={[THERMAL_LINEAR_CYLINDER_RADIUS_M, THERMAL_LINEAR_CYLINDER_RADIUS_M, length, 8]}
        />
        <meshStandardMaterial
          color={displayColor}
          metalness={0.08}
          roughness={0.68}
          emissive={selected ? readRootCssVar('--canvas-3d-thermal-bridge-emissive', '#6b5a12') : '#000000'}
          emissiveIntensity={selected ? THERMAL_BRIDGE_SELECTED_EMISSIVE_INTENSITY : 0}
          toneMapped
          polygonOffset
          polygonOffsetFactor={OPENING_POLYGON_OFFSET.factor}
          polygonOffsetUnits={OPENING_POLYGON_OFFSET.units}
          {...matDim}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {selected && !categoryGhost ? (
        <mesh
          position={[cx, primitive.baseElevationM + primitive.heightM / 2, cz]}
          quaternion={quat}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 2}
        >
          <cylinderGeometry
            args={[
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_SELECTION_RADIUS_SCALE,
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_SELECTION_RADIUS_SCALE,
              length,
              16,
            ]}
          />
          <SelectionOverlayMaterial opacity={THERMAL_BRIDGE_SELECTION_OVERLAY_OPACITY} />
        </mesh>
      ) : null}
      {showHoverHalo ? (
        <mesh
          position={[cx, primitive.baseElevationM + primitive.heightM / 2, cz]}
          quaternion={quat}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 2}
        >
          <cylinderGeometry
            args={[
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_HOVER_RADIUS_SCALE,
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_HOVER_RADIUS_SCALE,
              length,
              16,
            ]}
          />
          <HoverOverlayMaterial opacity={THERMAL_BRIDGE_HOVER_OVERLAY_OPACITY} />
        </mesh>
      ) : null}
    </group>
  );
};

/** Slope-mode `ThermalBridgeLinear`: cylinder axis follows the actual 3D endpoint coordinates. */
const ThermalBridgeLinearSlopedCylinder: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'thermal-bridge-sloped-line' }>;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, onSelect, currentFloorZ, categoryGhost = false }) => {
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const matDim = materialDimForCategoryGhost(
    meshStandardFloorDimmingProps(primitive.isCurrentFloor, isAboveCurrentFloor),
    categoryGhost,
  );
  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const [sx, sz] = modelXYToThreeXZ([primitive.start[0], primitive.start[2]]);
  const [ex, ez] = modelXYToThreeXZ([primitive.end[0], primitive.end[2]]);
  const start = useMemo(() => new THREE.Vector3(sx, primitive.start[1], sz), [sx, primitive.start, sz]);
  const end = useMemo(() => new THREE.Vector3(ex, primitive.end[1], ez), [ex, primitive.end, ez]);
  const mid = useMemo(() => start.clone().add(end).multiplyScalar(0.5), [start, end]);
  const length = start.distanceTo(end);
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, true);

  const quat = useMemo(() => {
    const dir = end.clone().sub(start);
    if (dir.lengthSq() < 1e-12) return new THREE.Quaternion();
    dir.normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [end, start]);

  if (length <= 0.0001) return null;

  return (
    <group visible={!categoryGhost}>
      <mesh
        position={mid}
        quaternion={quat}
        onClick={isInteractive ? ((event) => {
          event.stopPropagation();
          onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
        }) : undefined}
        {...hoverHandlers}
        raycast={meshRaycastForInteractivity(isInteractive)}
        castShadow={!isAboveCurrentFloor}
        receiveShadow={!isAboveCurrentFloor}
        renderOrder={renderOrder}
      >
        <cylinderGeometry
          args={[THERMAL_LINEAR_CYLINDER_RADIUS_M, THERMAL_LINEAR_CYLINDER_RADIUS_M, length, 8]}
        />
        <meshStandardMaterial
          color={displayColor}
          metalness={0.08}
          roughness={0.68}
          emissive={selected ? readRootCssVar('--canvas-3d-thermal-bridge-emissive', '#6b5a12') : '#000000'}
          emissiveIntensity={selected ? THERMAL_BRIDGE_SELECTED_EMISSIVE_INTENSITY : 0}
          toneMapped
          polygonOffset
          polygonOffsetFactor={OPENING_POLYGON_OFFSET.factor}
          polygonOffsetUnits={OPENING_POLYGON_OFFSET.units}
          {...matDim}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {selected && !categoryGhost ? (
        <mesh
          position={mid}
          quaternion={quat}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 2}
        >
          <cylinderGeometry
            args={[
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_SELECTION_RADIUS_SCALE,
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_SELECTION_RADIUS_SCALE,
              length,
              16,
            ]}
          />
          <SelectionOverlayMaterial opacity={THERMAL_BRIDGE_SELECTION_OVERLAY_OPACITY} />
        </mesh>
      ) : null}
      {showHoverHalo ? (
        <mesh
          position={mid}
          quaternion={quat}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 2}
        >
          <cylinderGeometry
            args={[
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_HOVER_RADIUS_SCALE,
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_HOVER_RADIUS_SCALE,
              length,
              16,
            ]}
          />
          <HoverOverlayMaterial opacity={THERMAL_BRIDGE_HOVER_OVERLAY_OPACITY} />
        </mesh>
      ) : null}
    </group>
  );
};

const WallSegmentMesh: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'wall-segment' }>;
  selected: boolean;
  showDetail: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, showDetail, onSelect, currentFloorZ, categoryGhost = false }) => {
  const isWindow = primitive.elementType === 'BuildingElementTransparent';
  const isOpening = primitive.isOpening;
  /** Linear TB strips: same depth bias as openings so they are not hidden inside wall volume. */
  const depthLikeOpening = isOpening || Boolean(primitive.renderAboveWallPlane);
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const wallMatDim = materialDimForCategoryGhost(
    primitive.usesFallbackHeight
      ? meshStandardFloorDimmingPropsWithBaseOpacity(
        primitive.isCurrentFloor,
        FALLBACK_HEIGHT_WALL_OPACITY,
        isAboveCurrentFloor,
      )
      : meshStandardFloorDimmingProps(primitive.isCurrentFloor, isAboveCurrentFloor),
    categoryGhost,
  );
  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const openingKind: 'window' | 'door' | null = isOpening
    ? (isWindow ? 'window' : 'door')
    : null;

  const [ax, az] = modelXYToThreeXZ(primitive.start);
  const [bx, bz] = modelXYToThreeXZ(primitive.end);
  const length = Math.hypot(bx - ax, bz - az);
  if (length <= 0.0001) return null;

  if (isServiceLineElementType(primitive.elementType)) {
    return (
      <ThermalBridgeLinearHorizontalCylinder
        primitive={primitive}
        selected={selected}
        onSelect={onSelect}
        currentFloorZ={currentFloorZ}
        ax={ax}
        az={az}
        bx={bx}
        bz={bz}
        length={length}
        categoryGhost={categoryGhost}
      />
    );
  }

  const cx = (ax + bx) / 2;
  const cz = (az + bz) / 2;
  const angle = modelSegmentToThreeYaw(primitive.start, primitive.end);
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, depthLikeOpening);

  const emissiveProps = openingKind
    ? openingEmissive(openingKind, primitive.isCurrentFloor)
    : { emissive: '#000000', emissiveIntensity: 0 };

  return (
    <group visible={!categoryGhost}>
      <mesh
        position={[cx, primitive.baseElevationM + primitive.heightM / 2, cz]}
        rotation={[0, angle, 0]}
        onClick={isInteractive ? ((event) => {
          event.stopPropagation();
          onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
        }) : undefined}
        {...hoverHandlers}
        raycast={meshRaycastForInteractivity(isInteractive)}
        castShadow={!isAboveCurrentFloor}
        receiveShadow={!isAboveCurrentFloor}
        renderOrder={renderOrder}
      >
        <boxGeometry args={[length, primitive.heightM, primitive.thicknessM]} />
        <meshStandardMaterial
          color={displayColor}
          metalness={isWindow ? 0.02 : 0.08}
          roughness={isWindow ? 0.2 : 0.68}
          {...emissiveProps}
          polygonOffset
          polygonOffsetFactor={depthLikeOpening ? OPENING_POLYGON_OFFSET.factor : WALL_POLYGON_OFFSET.factor}
          polygonOffsetUnits={depthLikeOpening ? OPENING_POLYGON_OFFSET.units : WALL_POLYGON_OFFSET.units}
          {...wallMatDim}
        />
        {isOpening && openingKind && !isAboveCurrentFloor ? (
          <Edges
            color={floorDimmedMeshColor(openingEdgeColor(openingKind), primitive.isCurrentFloor)}
            threshold={12}
            lineWidth={1}
          />
        ) : null}
        <WallSegmentWindowVentilationOverlays primitive={primitive} showDetail={showDetail} length={length} />
      </mesh>
      {primitive.usesFallbackHeight ? (
        <Line
          points={[
            [ax, primitive.baseElevationM + primitive.heightM, az],
            [bx, primitive.baseElevationM + primitive.heightM, bz],
          ]}
          color={floorDimmedMeshColor(readRootCssVar('--canvas-3d-fallback-edge', '#64748b'), primitive.isCurrentFloor)}
          lineWidth={1.2}
          dashed
          dashSize={0.18}
          gapSize={0.1}
          raycast={ignoreRaycast}
        />
      ) : null}
      {selected && !categoryGhost ? (
        <mesh
          position={[cx, primitive.baseElevationM + primitive.heightM / 2, cz]}
          rotation={[0, angle, 0]}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <boxGeometry args={[length, primitive.heightM, primitive.thicknessM]} />
          <SelectionOverlayMaterial opacity={SELECTION_OVERLAY_OPACITY} />
        </mesh>
      ) : null}
      {showHoverHalo ? (
        <mesh
          position={[cx, primitive.baseElevationM + primitive.heightM / 2, cz]}
          rotation={[0, angle, 0]}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <boxGeometry args={[length, primitive.heightM, primitive.thicknessM]} />
          <HoverOverlayMaterial />
        </mesh>
      ) : null}
    </group>
  );
};

/** Façade jambs: same XY on both ends — vertical segment in elevation (thin solid so walls don’t fully occlude). */
const ThermalBridgeVerticalLineMesh: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'thermal-bridge-vertical-line' }>;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, onSelect, currentFloorZ, categoryGhost = false }) => {
  const [tx, tz] = modelXYToThreeXZ(primitive.xy);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const matDim = materialDimForCategoryGhost(
    meshStandardFloorDimmingProps(primitive.isCurrentFloor, isAboveCurrentFloor),
    categoryGhost,
  );
  const heightM = Math.max(0.001, primitive.zTopM - primitive.zBottomM);
  const yMid = (primitive.zBottomM + primitive.zTopM) / 2;
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, true);

  return (
    <group visible={!categoryGhost}>
      <mesh
        position={[tx, yMid, tz]}
        renderOrder={renderOrder}
        onClick={
          isInteractive
            ? (event) => {
                event.stopPropagation();
                onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
              }
            : undefined
        }
        {...hoverHandlers}
        raycast={meshRaycastForInteractivity(isInteractive)}
        castShadow={!isAboveCurrentFloor}
        receiveShadow={!isAboveCurrentFloor}
      >
        <cylinderGeometry
          args={[THERMAL_LINEAR_CYLINDER_RADIUS_M, THERMAL_LINEAR_CYLINDER_RADIUS_M, heightM, 8]}
        />
        <meshStandardMaterial
          color={displayColor}
          metalness={0.08}
          roughness={0.68}
          emissive={selected ? readRootCssVar('--canvas-3d-thermal-bridge-emissive', '#6b5a12') : '#000000'}
          emissiveIntensity={selected ? THERMAL_BRIDGE_SELECTED_EMISSIVE_INTENSITY : 0}
          toneMapped
          polygonOffset
          polygonOffsetFactor={OPENING_POLYGON_OFFSET.factor}
          polygonOffsetUnits={OPENING_POLYGON_OFFSET.units}
          {...matDim}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {selected && !categoryGhost ? (
        <mesh
          position={[tx, yMid, tz]}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 2}
        >
          <cylinderGeometry
            args={[
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_SELECTION_RADIUS_SCALE,
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_SELECTION_RADIUS_SCALE,
              heightM,
              16,
            ]}
          />
          <SelectionOverlayMaterial opacity={THERMAL_BRIDGE_SELECTION_OVERLAY_OPACITY} />
        </mesh>
      ) : null}
      {showHoverHalo ? (
        <mesh
          position={[tx, yMid, tz]}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 2}
        >
          <cylinderGeometry
            args={[
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_HOVER_RADIUS_SCALE,
              THERMAL_LINEAR_CYLINDER_RADIUS_M * THERMAL_BRIDGE_HOVER_RADIUS_SCALE,
              heightM,
              16,
            ]}
          />
          <HoverOverlayMaterial opacity={THERMAL_BRIDGE_HOVER_OVERLAY_OPACITY} />
        </mesh>
      ) : null}
    </group>
  );
};

const OrientedBoxMesh: React.FC<{
  primitive: Extract<Geometry3DPrimitive, { kind: 'oriented-box' }>;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, onSelect, currentFloorZ, categoryGhost = false }) => {
  const quaternion = useMemo(
    () =>
      new THREE.Quaternion(
        primitive.quaternion[0],
        primitive.quaternion[1],
        primitive.quaternion[2],
        primitive.quaternion[3],
      ),
    [primitive.quaternion],
  );

  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const dim = materialDimForCategoryGhost(
    meshStandardFloorDimmingPropsWithBaseOpacity(
      primitive.isCurrentFloor,
      primitive.opacity ?? 1,
      isAboveCurrentFloor,
    ),
    categoryGhost,
  );
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, false);

  return (
    <group visible={!categoryGhost}>
      <mesh
        position={primitive.position}
        quaternion={quaternion}
        onClick={isInteractive ? ((event) => {
          event.stopPropagation();
          onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
        }) : undefined}
        {...hoverHandlers}
        raycast={meshRaycastForInteractivity(isInteractive)}
        castShadow={dim.depthWrite}
        receiveShadow={dim.depthWrite}
        renderOrder={renderOrder}
      >
        <boxGeometry args={primitive.size} />
        <meshStandardMaterial
          color={displayColor}
          metalness={0.06}
          roughness={0.5}
          transparent={dim.transparent}
          opacity={dim.opacity}
          depthWrite={dim.depthWrite}
          wireframe={dim.wireframe}
          emissive="#000000"
          emissiveIntensity={0}
        />
      </mesh>
      {selected && !categoryGhost ? (
        <mesh
          position={primitive.position}
          quaternion={quaternion}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <boxGeometry args={primitive.size} />
          <SelectionOverlayMaterial opacity={Math.min(0.42, SELECTION_OVERLAY_OPACITY)} />
        </mesh>
      ) : null}
      {showHoverHalo ? (
        <mesh
          position={primitive.position}
          quaternion={quaternion}
          raycast={ignoreRaycast}
          renderOrder={renderOrder + 1}
        >
          <boxGeometry args={primitive.size} />
          <HoverOverlayMaterial opacity={Math.min(0.32, HOVER_OVERLAY_OPACITY)} />
        </mesh>
      ) : null}
    </group>
  );
};

const PointMarkerMesh: React.FC<{
  primitive: PointMarkerPrimitive;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  currentFloorZ?: number;
  categoryGhost?: boolean;
}> = ({ primitive, selected, onSelect, currentFloorZ, categoryGhost = false }) => {
  const [sx, sz] = modelXYToThreeXZ(primitive.position);
  const y = primitive.baseElevationM + primitive.radiusM;
  const displayColor = floorDimmedMeshColor(primitive.color, primitive.isCurrentFloor);
  const isAboveCurrentFloor = isPrimitiveAboveActiveFloor(primitive.floorZ, currentFloorZ);
  const isInteractive = primitive.isCurrentFloor && !categoryGhost;
  const [hovered, hoverHandlers] = useHoverHalo(isInteractive);
  const showHoverHalo = hovered && !selected && !categoryGhost;
  const renderOrder = meshRenderOrderForFloor(primitive.isCurrentFloor, false);
  const planeSize = Math.max(0.08, primitive.radiusM * 4.8);
  const selectionRingOuterRadius = planeSize * 0.64;
  const selectionRingInnerRadius = planeSize * 0.52;
  const hoverRingOuterRadius = planeSize * 0.6;
  const hoverRingInnerRadius = planeSize * 0.51;

  const iconTexture = useMemo(() => {
    const size = 256;
    const iconSize = size * 0.72;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, size, size);
    const iconStroke = readRootCssVar('--canvas-3d-icon-stroke', '#ffffff');
    if (primitive.markerLabel) {
      const boxWidth = primitive.markerLabel === 'OUT' ? size * 0.62 : size * 0.5;
      const boxHeight = size * 0.34;
      const x = (size - boxWidth) / 2;
      const y0 = (size - boxHeight) / 2;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineWidth = selected ? 18 : 14;
      ctx.strokeStyle = displayColor;
      ctx.strokeRect(x, y0, boxWidth, boxHeight);
      ctx.lineWidth = selected ? 8 : 6;
      ctx.strokeStyle = iconStroke;
      ctx.strokeRect(x, y0, boxWidth, boxHeight);
      ctx.font = `700 ${primitive.markerLabel === 'OUT' ? 58 : 64}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = selected ? 12 : 9;
      ctx.strokeStyle = displayColor;
      ctx.strokeText(primitive.markerLabel, size / 2, size / 2 + 2);
      ctx.fillStyle = iconStroke;
      ctx.fillText(primitive.markerLabel, size / 2, size / 2 + 2);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate((size - iconSize) / 2, (size - iconSize) / 2);
      paintLucideIconOnCanvas(ctx, primitive.iconNode, {
        stroke: iconStroke,
        strokeWidth: selected ? 2.35 : 2,
        sizePx: iconSize,
        haloStroke: displayColor,
        haloStrokeWidth: selected ? 4.8 : 3.8,
      });
      ctx.restore();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, [primitive.iconNode, primitive.markerLabel, displayColor, selected]);

  useEffect(() => {
    return () => {
      iconTexture?.dispose();
    };
  }, [iconTexture]);

  const baseOpacity =
    (!primitive.isCurrentFloor ? 0.42 : isAboveCurrentFloor ? 0.38 : 0.96) *
    (categoryGhost ? CATEGORY_GHOST_OPACITY_FACTOR : 1);

  return (
    <Billboard position={[sx, y, sz]} follow visible={!categoryGhost}>
      {selected && !categoryGhost ? (
        <mesh raycast={ignoreRaycast} renderOrder={renderOrder}>
          <ringGeometry args={[selectionRingInnerRadius, selectionRingOuterRadius, 64]} />
          <SelectionOverlayMaterial opacity={Math.min(0.5, SELECTION_OVERLAY_OPACITY)} />
        </mesh>
      ) : null}
      <mesh
        onClick={
          isInteractive
            ? (event) => {
                event.stopPropagation();
                onSelect(primitive.elementId, !!event.nativeEvent.shiftKey);
              }
            : undefined
        }
        {...hoverHandlers}
        raycast={meshRaycastForInteractivity(isInteractive)}
        renderOrder={renderOrder + 1}
      >
        <planeGeometry args={[planeSize, planeSize]} />
        <meshBasicMaterial
          map={iconTexture ?? undefined}
          transparent
          opacity={baseOpacity}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-2}
        />
      </mesh>
      {showHoverHalo ? (
        <mesh raycast={ignoreRaycast} renderOrder={renderOrder}>
          <ringGeometry args={[hoverRingInnerRadius, hoverRingOuterRadius, 64]} />
          <HoverOverlayMaterial opacity={Math.min(0.42, HOVER_OVERLAY_OPACITY + 0.08)} />
        </mesh>
      ) : null}
    </Billboard>
  );
};

export const GeometryCanvas3D = memo<GeometryCanvas3DProps>(function GeometryCanvas3D({
  elementsById,
  elementIds,
  floors,
  globalOrientationOffset,
  currentFloorZ,
  selection,
  selectedElementIds,
  setSelection,
  frameRequest = null,
  onFrameRequestConsumed,
  isElementCategoryGhost = DEFAULT_IS_ELEMENT_CATEGORY_GHOST,
  snapCache,
}) {
  const themeId = useThemeStore((state) => state.themeId);
  const customTheme = useThemeStore((state) => state.customTheme);
  const updateElement = useGeometryStore((state) => state.updateElement);
  const commitVertexPositionUpdates = useGeometryStore((state) => state.commitVertexPositionUpdates);
  const snapCorners = useGeometryStore((state) => state.snapCorners);
  const snapTol = useGeometryStore((state) => ((state as { PROJECT_DEFAULTS?: { snap_m?: number } }).PROJECT_DEFAULTS?.snap_m ?? 0.1));
  const [editDragging, setEditDragging] = useState(false);
  const [editPreviewElementsById, setEditPreviewElementsById] = useState<Geometry3DEditPreviewElementsById | null>(null);
  const primitives = useMemo(
    () => {
      void themeId;
      void customTheme;
      return buildGeometry3DPrimitives({ elementsById, elementIds, floors, currentFloorZ, globalOrientationOffset });
    },
    [elementsById, elementIds, floors, currentFloorZ, globalOrientationOffset, themeId, customTheme],
  );
  const editPreviewElementIds = useMemo(
    () => Object.keys(editPreviewElementsById ?? {}),
    [editPreviewElementsById],
  );
  const editPreviewElementIdSet = useMemo(
    () => new Set(editPreviewElementIds),
    [editPreviewElementIds],
  );
  const editPreviewSceneElementsById = useMemo(
    () => editPreviewElementsById
      ? { ...elementsById, ...editPreviewElementsById }
      : elementsById,
    [editPreviewElementsById, elementsById],
  );
  const editPreviewPrimitives = useMemo(
    () => editPreviewElementsById
      ? buildGeometry3DPrimitives({
          elementsById: editPreviewSceneElementsById,
          elementIds: editPreviewElementIds,
          floors,
          currentFloorZ,
          globalOrientationOffset,
        })
      : [],
    [currentFloorZ, editPreviewElementIds, editPreviewElementsById, editPreviewSceneElementsById, floors, globalOrientationOffset],
  );

  const center = useMemo<[number, number, number]>(() => {
    if (primitives.length === 0) return [0, 0, 0];
    const points: Array<[number, number, number]> = [];

    for (const primitive of primitives) {
      if (primitive.kind === 'wall-segment') {
        const [sx, sz] = modelXYToThreeXZ(primitive.start);
        const [ex, ez] = modelXYToThreeXZ(primitive.end);
        points.push([
          sx,
          primitive.baseElevationM + primitive.heightM / 2,
          sz,
        ]);
        points.push([
          ex,
          primitive.baseElevationM + primitive.heightM / 2,
          ez,
        ]);
      } else if (primitive.kind === 'thermal-bridge-vertical-line') {
        const [px, pz] = modelXYToThreeXZ(primitive.xy);
        points.push([px, (primitive.zBottomM + primitive.zTopM) / 2, pz]);
      } else if (primitive.kind === 'thermal-bridge-sloped-line') {
        const [sx, sz] = modelXYToThreeXZ([primitive.start[0], primitive.start[2]]);
        const [ex, ez] = modelXYToThreeXZ([primitive.end[0], primitive.end[2]]);
        points.push([sx, primitive.start[1], sz]);
        points.push([ex, primitive.end[1], ez]);
      } else if (primitive.kind === 'point-marker') {
        const [px, pz] = modelXYToThreeXZ(primitive.position);
        points.push([px, primitive.baseElevationM + primitive.radiusM, pz]);
      } else if (primitive.kind === 'oriented-box') {
        points.push(primitive.position);
      } else if (primitive.kind === 'polygon-prism') {
        for (const point of primitive.points) {
          const [px, pz] = modelXYToThreeXZ(point);
          points.push([px, primitive.baseElevationM + primitive.heightM / 2, pz]);
        }
      } else if (primitive.kind === 'polygon-sloped') {
        for (const point of primitive.points) {
          const [px, pz] = modelXYToThreeXZ(point);
          points.push([px, primitive.baseElevationM, pz]);
        }
      } else if (primitive.kind === 'planar-face') {
        for (const [modelX, elevation, modelY] of primitive.points) {
          const [px, pz] = modelXYToThreeXZ([modelX, modelY]);
          points.push([px, elevation, pz]);
        }
      }
    }

    const avg = points.reduce(
      (acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]],
      [0, 0, 0] as [number, number, number],
    );

    return [avg[0] / points.length, avg[1] / points.length, avg[2] / points.length];
  }, [primitives]);

  /** Keep orbit target / default camera fixed while geometry edits change the live centroid (avoids view reset). */
  const [stableSceneCenter] = useKeyedState<[number, number, number] | null>(
    primitives.length === 0 ? 'empty' : 'populated',
    primitives.length === 0 ? null : [center[0], center[1], center[2]],
  );

  const orbitTarget = stableSceneCenter ?? center;

  /** Mutable ref so Canvas children can read latest target without reactive props (which reset camera/orbit). */
  const orbitTargetRef = useRef(orbitTarget);
  const primitivesRef = useRef(primitives);
  useLayoutEffect(() => {
    orbitTargetRef.current = orbitTarget;
    primitivesRef.current = primitives;
  }, [orbitTarget, primitives]);
  const dormerCutoutOverlays = useMemo(
    () => collectDormerCutoutOverlays(elementsById, floors, selection, globalOrientationOffset),
    [elementsById, floors, selection, globalOrientationOffset],
  );
  const editHandleModel = useMemo(() => {
    if (selection?.type !== 'element' && selection?.type !== 'global') return null;
    const element = editPreviewSceneElementsById[selection.id];
    if (!element) return null;
    if (!isElementOnActiveCanvasFloor(element, currentFloorZ, floors)) return null;
    if (isElementCategoryGhost(element.id)) return null;
    return buildGeometry3DEditHandleModel(
      element,
      editPreviewElementsById ? editPreviewPrimitives : primitives,
      editPreviewSceneElementsById,
    );
  }, [
    currentFloorZ,
    editPreviewElementsById,
    editPreviewPrimitives,
    editPreviewSceneElementsById,
    floors,
    isElementCategoryGhost,
    primitives,
    selection,
  ]);

  const renderPrimitive = (primitive: Geometry3DPrimitive, index: number, keyPrefix = '') => {
    const categoryGhost = isElementCategoryGhost(primitive.elementId);
    const directlySelected =
      primitive.isCurrentFloor &&
      (selection?.type === 'element' || selection?.type === 'global') &&
      selection.id === primitive.elementId;
    const selected =
      primitive.isCurrentFloor &&
      (selectedElementIds ?? []).includes(primitive.elementId);
    const key = `${keyPrefix}${primitive.kind}-${primitive.elementId}-${index}`;
    const onSelect = (id: string, additive: boolean) => {
      const info = getDormerBundleInfo(editPreviewSceneElementsById[id] ?? elementsById[id]);
      if (info) {
        setSelection({ type: 'dormer', id: info.bundle_id }, additive);
        return;
      }
      const selectedElement = editPreviewSceneElementsById[id] ?? elementsById[id];
      if (!selectedElement) return;
      setSelection(selectionForElement(selectedElement), additive);
    };

    switch (primitive.kind) {
      case 'wall-segment':
        return (
          <WallSegmentMesh
            key={key}
            primitive={primitive}
            selected={selected}
            showDetail={directlySelected}
            onSelect={onSelect}
            currentFloorZ={currentFloorZ}
            categoryGhost={categoryGhost}
          />
        );
      case 'thermal-bridge-vertical-line':
        return (
          <ThermalBridgeVerticalLineMesh
            key={key}
            primitive={primitive}
            selected={selected}
            onSelect={onSelect}
            currentFloorZ={currentFloorZ}
            categoryGhost={categoryGhost}
          />
        );
      case 'thermal-bridge-sloped-line':
        return (
          <ThermalBridgeLinearSlopedCylinder
            key={key}
            primitive={primitive}
            selected={selected}
            onSelect={onSelect}
            currentFloorZ={currentFloorZ}
            categoryGhost={categoryGhost}
          />
        );
      case 'point-marker':
        return (
          <PointMarkerMesh
            key={key}
            primitive={primitive}
            selected={selected}
            onSelect={onSelect}
            currentFloorZ={currentFloorZ}
            categoryGhost={categoryGhost}
          />
        );
      case 'oriented-box':
        return (
          <OrientedBoxMesh
            key={key}
            primitive={primitive}
            selected={selected}
            onSelect={onSelect}
            currentFloorZ={currentFloorZ}
            categoryGhost={categoryGhost}
          />
        );
      case 'polygon-sloped':
        return (
          <PolygonSlopedMesh
            key={key}
            primitive={primitive}
            selected={selected}
            onSelect={onSelect}
            currentFloorZ={currentFloorZ}
            categoryGhost={categoryGhost}
          />
        );
      case 'planar-face':
        return (
          <PlanarFaceMesh
            key={key}
            primitive={primitive}
            selected={selected}
            onSelect={onSelect}
            currentFloorZ={currentFloorZ}
            categoryGhost={categoryGhost}
          />
        );
      case 'polygon-prism':
        return (
          <PolygonPrismMesh
            key={key}
            primitive={primitive}
            selected={selected}
            showDetail={directlySelected}
            onSelect={onSelect}
            currentFloorZ={currentFloorZ}
            categoryGhost={categoryGhost}
          />
        );
      default: {
        // Exhaustiveness guard: if a new primitive kind is added, TypeScript should fail here.
        const _never: never = primitive;
        return _never;
      }
    }
  };

  if (primitives.length === 0) {
    return (
      <div className="geometry-canvas-3d geometry-canvas-3d-empty" data-testid="geometry-canvas-3d">
        No elements with coordinates to show in 3D yet.
      </div>
    );
  }

  return (
    <div className="geometry-canvas-3d" data-testid="geometry-canvas-3d">
      {/*
        Do not use Canvas `onCreated` for camera setup: R3F's Canvas re-invokes configure/onCreated on many
        layout passes, which kept resetting the camera. See InitialPerspectiveCamera + imperative orbit target.
      */}
      {/* `shadows="percentage"` = PCFShadowMap, the non-deprecated successor to PCFSoftShadowMap.
          The default `shadows` boolean still picks PCFSoftShadowMap, which logs a deprecation
          warning every animation frame in recent three.js. */}
      <Canvas
        gl={createGeometryCanvasRenderer}
        shadows="percentage"
        onPointerMissed={() => setSelection(null)}
      >
        <color attach="background" args={[readRootCssVar('--canvas-3d-bg', '#0d1417')]} />
        <InitialPerspectiveCamera orbitTargetRef={orbitTargetRef} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
        <Grid
          position={[orbitTarget[0], -0.03, orbitTarget[2]]}
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.8}
          sectionSize={5}
          sectionThickness={1.2}
          cellColor={readRootCssVar('--canvas-3d-grid-cell', '#27383d')}
          sectionColor={readRootCssVar('--canvas-3d-grid-section', '#4b6269')}
          fadeDistance={80}
          fadeStrength={1}
        />

        {primitives.map((primitive, index) => (
          editPreviewElementIdSet.has(primitive.elementId)
            ? null
            : renderPrimitive(primitive, index)
        ))}
        {editPreviewPrimitives.map((primitive, index) => renderPrimitive(primitive, index, 'preview-'))}
        {dormerCutoutOverlays.map((overlay, index) => (
          <Line
            key={`dormer-cutout-${overlay.hostElementId}-${index}`}
            points={[...overlay.points, overlay.points[0]]}
            color={readRootCssVar('--canvas-3d-dormer-cutout', '#f6df5a')}
            lineWidth={1.5}
            transparent
            opacity={0.95}
            depthWrite={false}
            depthTest={false}
          />
        ))}
        {editHandleModel ? (
          <Geometry3DEditHandles
            element={elementsById[editHandleModel.elementId]}
            model={editHandleModel}
            elementsById={elementsById}
            snapCache={snapCache}
            snapTol={snapTol}
            snapCorners={snapCorners}
            updateElement={updateElement}
            commitVertexPositionUpdates={commitVertexPositionUpdates}
            setEditDragging={setEditDragging}
            setPreviewElementsById={setEditPreviewElementsById}
            floors={floors}
          />
        ) : null}

        <OrbitControlsWithFrame
          orbitTargetRef={orbitTargetRef}
          frameRequest={frameRequest}
          primitivesRef={primitivesRef}
          onFrameRequestConsumed={onFrameRequestConsumed}
          disabled={editDragging}
        />
      </Canvas>
    </div>
  );
});

// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { IconNode } from 'lucide';
import type { Element } from '../stores/geometryStore';

export type Geometry3DPrimitive =
  | WallSegmentPrimitive
  | PolygonPrismPrimitive
  | PolygonSlopedPrimitive
  | PlanarFacePrimitive
  | PointMarkerPrimitive
  | OrientedBoxPrimitive
  | ThermalBridgeSlopedLinePrimitive
  | ThermalBridgeVerticalLinePrimitive;

/**
 * Façade jamb lines share the same plan XY on both ends; {@link WallSegmentPrimitive} would have zero length in plan.
 * Rendered as a vertical line in 3D between model elevations zBottomM and zTopM.
 */
export interface ThermalBridgeVerticalLinePrimitive {
  kind: 'thermal-bridge-vertical-line';
  elementId: string;
  elementType: Element['type'];
  floorZ: number;
  xy: [number, number];
  zBottomM: number;
  zTopM: number;
  color: string;
  isCurrentFloor: boolean;
}

/** Slope-mode linear TB: rendered as a single cylinder between both 3D endpoint coordinates. */
export interface ThermalBridgeSlopedLinePrimitive {
  kind: 'thermal-bridge-sloped-line';
  elementId: string;
  elementType: Element['type'];
  floorZ: number;
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  isCurrentFloor: boolean;
}

/** HEM window ventilation fields — shown in 3D when the selected element is a window */
export interface WindowVentilation3D {
  max_window_open_area?: number;
  free_area_height?: number;
  frame_area_fraction?: number;
}

export interface WallSegmentPrimitive {
  kind: 'wall-segment';
  elementId: string;
  elementType: Element['type'];
  floorZ: number;
  start: [number, number];
  end: [number, number];
  baseElevationM: number;
  heightM: number;
  thicknessM: number;
  color: string;
  isOpening: boolean;
  isCurrentFloor: boolean;
  /** True when 3D uses a preview height because the element has no positive height value. */
  usesFallbackHeight?: boolean;
  windowVentilation?: WindowVentilation3D;
  /** Linear TB strips: use opening-style depth bias so geometry is not buried in wall volume (like window openings). */
  renderAboveWallPlane?: boolean;
}

export interface PolygonPrismPrimitive {
  kind: 'polygon-prism';
  elementId: string;
  elementType: Element['type'];
  floorZ: number;
  points: Array<[number, number]>;
  baseElevationM: number;
  heightM: number;
  color: string;
  isOpening: boolean;
  isCurrentFloor: boolean;
  /** True when 3D uses a preview height because the element has no positive height value. */
  usesFallbackHeight?: boolean;
  windowVentilation?: WindowVentilation3D;
}

/** Pitched planar surface: first edge (points[0]→points[1]) is low eaves; upslope into polygon interior. */
export interface PolygonSlopedPrimitive {
  kind: 'polygon-sloped';
  elementId: string;
  elementType: Element['type'];
  floorZ: number;
  points: Array<[number, number]>;
  /** Elevation (m) along the eaves line (lowest edge) */
  baseElevationM: number;
  pitchDeg: number;
  /** Unit inward normal in model XY (upslope in plan) */
  inwardNormal2D: [number, number];
  thicknessM: number;
  color: string;
  isOpening: boolean;
  isCurrentFloor: boolean;
  opacity?: number;
}

/** Arbitrary 3D face used for triangular cheeks, gable ends, and similar non-rectangular wall surfaces. */
export interface PlanarFacePrimitive {
  kind: 'planar-face';
  elementId: string;
  elementType: Element['type'];
  floorZ: number;
  isCurrentFloor: boolean;
  color: string;
  points: Array<[number, number, number]>;
  isOpening: boolean;
  opacity?: number;
}

export interface PointMarkerPrimitive {
  kind: 'point-marker';
  elementId: string;
  elementType: Element['type'];
  floorZ: number;
  position: [number, number];
  baseElevationM: number;
  radiusM: number;
  color: string;
  isCurrentFloor: boolean;
  /** Lucide icon node for 2D/3D point marker (see `getPointElementIconNode` in `pointElementIconSpec.ts`). */
  iconNode: IconNode;
  /** Short text marker for custom point symbols that are not Lucide icons, e.g. MVHR IN/OUT terminals. */
  markerLabel?: string;
}

/** Axis-aligned box in local space, positioned/oriented in world (Three.js Y up). */
export interface OrientedBoxPrimitive {
  kind: 'oriented-box';
  elementId: string;
  elementType: Element['type'];
  floorZ: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  size: [number, number, number];
  color: string;
  opacity?: number;
  isCurrentFloor: boolean;
}

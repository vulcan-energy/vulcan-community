// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Minimal shape utilities to support Phase 1 without changing existing behavior
import type { Element, ElementType } from '../stores/geometryStore';
import { modelToCanvas2D, canvasToModel2D } from './geometryTransform';
import { getMechanicalVentilationDuctworkRoleStyle } from './mvhrDuctwork';

export type CanvasShape = 'line' | 'polygon' | 'sloped-polygon' | 'point';

export type ElementCanvasPalette = Partial<{
  selected: string;
  externalWallStroke: string;
  externalWallFill: string;
  internalWallStroke: string;
  internalWallFill: string;
  partyWallStroke: string;
  partyWallFill: string;
  adjacentUnconditionedStroke: string;
  adjacentUnconditionedFill: string;
  wallStroke: string;
  wallFill: string;
  doorStroke: string;
  doorFill: string;
  windowStroke: string;
  windowFill: string;
  groundStroke: string;
  groundFill: string;
  adjacentStroke: string;
  adjacentFill: string;
  contextStroke: string;
  contextFill: string;
  thermalBridgeStroke: string;
  thermalBridgeSelectedStroke: string;
  shadingStroke: string;
  lightingStroke: string;
  ductworkStroke: string;
  pipeworkStroke: string;
  emitterStroke: string;
  applianceStroke: string;
  hotWaterStroke: string;
  ventStroke: string;
  mechanicalVentilationStroke: string;
  combustionStroke: string;
  onsiteGenerationStroke: string;
  batteryStroke: string;
  systemStroke: string;
}>;

export function withCanvasAlpha(color: string | undefined, fallback: string, alphaHex: string): string {
  const base = color || fallback;
  return /^#[0-9a-f]{6}$/i.test(base) ? `${base}${alphaHex}` : `${fallback}${alphaHex}`;
}

// Determine canonical canvas shape for an element from its coordinates and fields
export function getElementShape(element: Element | undefined | null): CanvasShape {
  if (!element || !Array.isArray((element as any).coordinates)) return 'point';
  const coordCount = (element as any).coordinates.length;
  if (coordCount <= 1) return 'point';
  if (coordCount === 2) return 'line';

  // Check for sloped polygon: pitch > 0 && pitch < 90
  const pitch = (element as any).pitch;
  if (pitch !== undefined && pitch > 0 && pitch < 90) {
    return 'sloped-polygon';
  }

  return 'polygon';
}

/** True if the user may remove a vertex to leave a valid closed plan polygon (3+ points remain). */
export function canDeleteVertexFromElement(element: Element | undefined | null): boolean {
  if (!element?.coordinates) return false;
  if (element.coordinates.length <= 3) return false;
  const shape = getElementShape(element);
  return shape === 'polygon' || shape === 'sloped-polygon';
}

// List compatible element types for a given canonical shape
export function getCompatibleElementTypes(shape: CanvasShape): ElementType[] {
  switch (shape) {
    case 'point':
      return [
        'ThermalBridgePoint',
        'ThermalBridgeLinear',
        'Lighting',
        // Object-like elements that are placed as points
        'Appliance',
        'HotWaterDemand',
        'Vents',
        'MechanicalVentilation',
        'MechanicalVentilationTerminal',
        'CombustionAppliances',
        // Shading objects are point-placed
        'WindowShading',
        // System elements
        'ElectricBattery',
        'System',
      ] as ElementType[];
    case 'line':
      return [
        'BuildingElementOpaque',
        'BuildingElementTransparent',
        'BuildingElementGround',
        'BuildingElementAdjacentConditionedSpace',
        'BuildingElementAdjacentUnconditionedSpace_Simple',
        'BuildingElementPartyWall',
        'ThermalBridgeLinear',
        'MechanicalVentilationDuctwork',
        'WaterPipework',
        // Heating system distribution (radiator/fancoil)
        'WetEmitter',
      ] as ElementType[];
    case 'polygon':
      return [
        'BuildingElementOpaque',
        'BuildingElementTransparent',
        'BuildingElementGround',
        'ContextShading',
        'BuildingElementAdjacentConditionedSpace',
        'BuildingElementAdjacentUnconditionedSpace_Simple',
        // Party wall: line (wall segment) only — not horizontal polygons / ceilings
        // Heating system distribution (underfloor heating)
        'WetEmitter',
        // On-site generation (flat solar panels)
        'OnSiteGeneration',
      ] as ElementType[];
    case 'sloped-polygon':
      return [
        'BuildingElementOpaque',
        'BuildingElementTransparent',
        // On-site generation (sloped solar panels)
        'OnSiteGeneration',
      ] as ElementType[];
    default:
      return [] as ElementType[];
  }
}

// Centralize element color by type (keeps current look as much as possible)
export function getElementColor(
  element: Element,
  isSelected: boolean,
  palette: ElementCanvasPalette = {},
): { stroke: string; fill?: string } {
  const t = element.type;
  // Preserve selected styling prominence
  const highlight = isSelected ? (palette.selected || '#00a2ff') : undefined;

  // Special handling for external doors
  const externalDoorPitch = (element as { pitch?: unknown }).pitch;
  const isVerticalExternalDoor =
    t === 'BuildingElementOpaque' &&
    (element as { is_external_door?: unknown }).is_external_door === true &&
    Array.isArray((element as { coordinates?: unknown }).coordinates) &&
    ((element as { coordinates?: unknown[] }).coordinates?.length ?? 0) === 2 &&
    (typeof externalDoorPitch !== 'number' || !Number.isFinite(externalDoorPitch) || Math.round(externalDoorPitch) === 90);
  if (isVerticalExternalDoor) {
    return {
      stroke: highlight || palette.doorStroke || '#FF8C00',
      fill: palette.doorFill || '#FF8C0022',
    }; // Orange for external doors
  }

  switch (t) {
    case 'BuildingElementOpaque':
      return {
        stroke: highlight || palette.externalWallStroke || palette.wallStroke || '#CCCCCC',
        fill: palette.externalWallFill || palette.wallFill || '#CCCCCC22',
      };
    case 'BuildingElementTransparent':
      return {
        stroke: highlight || palette.windowStroke || '#87CEEB',
        fill: palette.windowFill || '#87CEEB22',
      }; // Sky blue for windows
    case 'BuildingElementGround':
      return {
        stroke: highlight || palette.groundStroke || '#228B22',
        fill: palette.groundFill || '#228B2255',
      }; // Forest green for floors
    case 'BuildingElementAdjacentConditionedSpace':
      return {
        stroke: highlight || palette.internalWallStroke || palette.adjacentStroke || '#8BD3FF',
        fill: palette.internalWallFill || palette.adjacentFill || '#8BD3FF22',
      };
    case 'BuildingElementAdjacentUnconditionedSpace_Simple':
      return {
        stroke: highlight || palette.adjacentUnconditionedStroke || palette.adjacentStroke || '#FBBF24',
        fill: palette.adjacentUnconditionedFill || palette.adjacentFill || '#FBBF2422',
      };
    case 'BuildingElementPartyWall':
      return {
        stroke: highlight || palette.partyWallStroke || palette.adjacentStroke || '#C084FC',
        fill: palette.partyWallFill || palette.adjacentFill || '#C084FC22',
      };
    case 'ThermalBridgeLinear':
      return {
        stroke: isSelected
          ? (palette.thermalBridgeSelectedStroke || highlight || '#FF7A3D')
          : (palette.thermalBridgeStroke || '#FF6B35'),
      };
    case 'ThermalBridgePoint':
      return {
        stroke: isSelected
          ? (palette.thermalBridgeSelectedStroke || highlight || '#FF7A3D')
          : (palette.thermalBridgeStroke || '#DC143C'),
      };
    case 'WindowShading':
      return {
        stroke: highlight || palette.shadingStroke || '#F4C430',
        fill: withCanvasAlpha(palette.shadingStroke, '#F4C430', '22'),
      };
    case 'Lighting':
      return { stroke: highlight || palette.lightingStroke || '#FFB347' };
    case 'MechanicalVentilationDuctwork':
      return { stroke: highlight || getMechanicalVentilationDuctworkRoleStyle(element).stroke };
    case 'MechanicalVentilationTerminal':
      return { stroke: highlight || palette.mechanicalVentilationStroke || '#2DD4BF' };
    case 'WaterPipework':
      return { stroke: highlight || palette.pipeworkStroke || '#38BDF8' };
    case 'WetEmitter':
      return { stroke: highlight || palette.emitterStroke || '#60A5FA' };
    case 'Appliance':
      return { stroke: highlight || palette.applianceStroke || '#CBD5E1' };
    case 'HotWaterDemand':
      return { stroke: highlight || palette.hotWaterStroke || '#FB7185' };
    case 'ContextShading':
      return {
        stroke: highlight || palette.contextStroke || '#808080',
        fill: palette.contextFill || '#80808022',
      }; // Gray for context
    case 'Vents':
      return { stroke: highlight || palette.ventStroke || '#22D3EE' };
    case 'MechanicalVentilation':
      return { stroke: highlight || palette.mechanicalVentilationStroke || '#2DD4BF' };
    case 'CombustionAppliances':
      return { stroke: highlight || palette.combustionStroke || '#FF7A3D' };
    case 'OnSiteGeneration':
      return {
        stroke: highlight || palette.onsiteGenerationStroke || '#FACC15',
        fill: withCanvasAlpha(palette.onsiteGenerationStroke, '#FACC15', '22'),
      };
    case 'ElectricBattery':
      return {
        stroke: highlight || palette.batteryStroke || '#A78BFA',
        fill: withCanvasAlpha(palette.batteryStroke, '#A78BFA', '22'),
      };
    case 'System':
      return {
        stroke: highlight || palette.systemStroke || '#FB923C',
        fill: withCanvasAlpha(palette.systemStroke, '#FB923C', '22'),
      };
    default:
      return { stroke: highlight || '#555' };
  }
}


// Determine if an element type is compatible with a given canvas shape
export function isTypeShapeCompatible(type: ElementType, shape: CanvasShape): boolean {
  const compat = getCompatibleElementTypes(shape);
  return compat.includes(type);
}

// Convert coordinates between shapes with sensible defaults
export function convertShapeCoordinates(
  element: Element,
  targetShape: CanvasShape
): Array<{ x: number; y: number; z: number }> {
  const coords = (element.coordinates || []) as Array<{ x: number; y: number; z: number }>;
  const currentShape = getElementShape(element);
  if (currentShape === targetShape) return coords;

  // Default z from first point
  const z = coords[0]?.z ?? 0;

  if (targetShape === 'point') {
    // Use centroid or first point
    if (coords.length === 0) return [{ x: 0, y: 0, z }];
    if (coords.length === 1) return [{ ...coords[0] }];
    const cx = coords.reduce((s, c) => s + c.x, 0) / coords.length;
    const cy = coords.reduce((s, c) => s + c.y, 0) / coords.length;
    return [{ x: cx, y: cy, z }];
  }

  if (targetShape === 'line') {
    // From polygon: choose longest edge; from point: create segment using preserved length
    if (coords.length >= 3) {
      let bestI = 0;
      let bestLen = -1;
      for (let i = 0; i < coords.length; i++) {
        const a = coords[i];
        const b = coords[(i + 1) % coords.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > bestLen) { bestLen = len; bestI = i; }
      }
      const A = coords[bestI];
      const B = coords[(bestI + 1) % coords.length];
      return [
        { x: A.x, y: A.y, z: A.z ?? z },
        { x: B.x, y: B.y, z: B.z ?? z }
      ];
    }
    if (coords.length === 1) {
      const A = coords[0];
      // For ThermalBridgeLinear, use preserved length if available
      let length = 0.5; // Default length
      if (element.type === 'ThermalBridgeLinear' && 'length' in element && typeof element.length === 'number' && element.length > 0) {
        length = element.length;
      }
      // Create horizontal line (as specified by user)
      return [
        { x: A.x, y: A.y, z: A.z ?? z },
        { x: A.x + length, y: A.y, z: A.z ?? z }
      ];
    }
    // already a line or empty
    return coords.slice(0, 2);
  }

  if (targetShape === 'polygon') {
    // From line: extrude a thin rectangle around the segment; from point: small triangle
    if (coords.length === 2) {
      const [A, B] = coords;
      const thickness = 0.2; // 20cm default visual thickness
      const dx = B.x - A.x; const dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len; const uy = dy / len;
      // normal vector
      const nx = -uy; const ny = ux;
      const half = thickness / 2;
      const p1 = { x: A.x + nx * half, y: A.y + ny * half, z: A.z ?? z };
      const p2 = { x: B.x + nx * half, y: B.y + ny * half, z: B.z ?? z };
      const p3 = { x: B.x - nx * half, y: B.y - ny * half, z: B.z ?? z };
      const p4 = { x: A.x - nx * half, y: A.y - ny * half, z: A.z ?? z };
      return [p1, p2, p3, p4];
    }
    if (coords.length === 1) {
      const A = coords[0];
      return [
        { x: A.x - 0.2, y: A.y - 0.2, z: A.z ?? z },
        { x: A.x + 0.2, y: A.y - 0.2, z: A.z ?? z },
        { x: A.x + 0.2, y: A.y + 0.2, z: A.z ?? z },
        { x: A.x - 0.2, y: A.y + 0.2, z: A.z ?? z }
      ];
    }
    // already polygon
    return coords;
  }

  if (targetShape === 'sloped-polygon') {
    // Same as polygon conversion - sloped-polygon is just a polygon with special rendering
    return convertShapeCoordinates(element, 'polygon');
  }

  return coords;
}

// Geometric intersection utilities for marquee selection and collision detection

// Check if two line segments intersect
export function segmentsIntersect(
  p1: { x: number, y: number },
  p2: { x: number, y: number },
  p3: { x: number, y: number },
  p4: { x: number, y: number }
): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false; // parallel lines

  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// Find intersection point of two line segments
// Returns intersection point if segments intersect, null otherwise
export function lineIntersection(
  p1: { x: number, y: number },
  p2: { x: number, y: number },
  p3: { x: number, y: number },
  p4: { x: number, y: number }
): { x: number, y: number } | null {
  const ax = p1.x; const ay = p1.y;
  const bx = p2.x; const by = p2.y;
  const cx = p3.x; const cy = p3.y;
  const dx = p4.x; const dy = p4.y;

  const den = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
  if (Math.abs(den) < 1e-9) {
    return null; // parallel lines
  }

  const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / den;
  const ix = ax + t * (bx - ax);
  const iy = ay + t * (by - ay);

  return { x: ix, y: iy };
}

// Normalized cross product colinearity test (scale-invariant)
export function isColinear(
  a1: { x: number, y: number },
  a2: { x: number, y: number },
  b1: { x: number, y: number },
  b2: { x: number, y: number },
  tol: number = 1e-6
): boolean {
  const ux = a2.x - a1.x; const uy = a2.y - a1.y;
  const vx = b2.x - b1.x; const vy = b2.y - b1.y;
  const ulen = Math.hypot(ux, uy);
  const vlen = Math.hypot(vx, vy);
  if (ulen === 0 || vlen === 0) return false;
  const crossNorm = Math.abs(ux * vy - uy * vx) / (ulen * vlen);
  return crossNorm <= tol;
}

// Check if point lies on segment within tolerance
export function onSegment(
  s1: { x: number, y: number },
  s2: { x: number, y: number },
  p: { x: number, y: number },
  tol: number = 1e-6
): boolean {
  const minX = Math.min(s1.x, s2.x) - tol;
  const maxX = Math.max(s1.x, s2.x) + tol;
  const minY = Math.min(s1.y, s2.y) - tol;
  const maxY = Math.max(s1.y, s2.y) + tol;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

// Check if a line segment intersects with a rectangle
export function segmentIntersectsRect(
  p1: { x: number, y: number },
  p2: { x: number, y: number },
  rect: { minX: number, maxX: number, minY: number, maxY: number }
): boolean {
  // Check if either endpoint is inside the rectangle
  if ((p1.x >= rect.minX && p1.x <= rect.maxX && p1.y >= rect.minY && p1.y <= rect.maxY) ||
      (p2.x >= rect.minX && p2.x <= rect.maxX && p2.y >= rect.minY && p2.y <= rect.maxY)) {
    return true;
  }

  // Check if segment intersects any of the rectangle's edges
  const edges = [
    { x1: rect.minX, y1: rect.minY, x2: rect.maxX, y2: rect.minY }, // top
    { x1: rect.maxX, y1: rect.minY, x2: rect.maxX, y2: rect.maxY }, // right
    { x1: rect.maxX, y1: rect.maxY, x2: rect.minX, y2: rect.maxY }, // bottom
    { x1: rect.minX, y1: rect.maxY, x2: rect.minX, y2: rect.minY }  // left
  ];

  for (const edge of edges) {
    if (segmentsIntersect(p1, p2, { x: edge.x1, y: edge.y1 }, { x: edge.x2, y: edge.y2 })) {
      return true;
    }
  }

  return false;
}

/**
 * World plan (x,y) center of the axis-aligned bounding box of all element vertex coordinates.
 * Used to frame the 2D view after a full model import.
 */
export function computePlanViewBoundsCenter(elements: Element[]): { x: number; y: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const el of elements) {
    const coords = (el as { coordinates?: Array<{ x: number; y: number }> }).coordinates;
    if (!coords || coords.length === 0) continue;
    for (const p of coords) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
  }
  if (xs.length === 0) return null;
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

// Coordinate transformation utilities

// Convert element coordinates to canvas coordinates
export function worldToCanvas(
  worldCoord: {x: number, y: number},
  scale: number,
  panOffset: {x: number, y: number},
  canvasCenter: {x: number, y: number}
) {
  return modelToCanvas2D(worldCoord, { scale, panOffset, canvasCenter });
}

// Convert canvas coordinates to world coordinates
export function canvasToWorld(
  canvasCoord: {x: number, y: number},
  scale: number,
  panOffset: {x: number, y: number},
  canvasCenter: {x: number, y: number}
) {
  return canvasToModel2D(canvasCoord, { scale, panOffset, canvasCenter });
}

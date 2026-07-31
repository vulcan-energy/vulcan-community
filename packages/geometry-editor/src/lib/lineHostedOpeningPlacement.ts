// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  BuildingElementOpaque,
  BuildingElementTransparent,
  Element,
} from '../geometry/types';
import { isOpaqueExternalDoorLineElement } from './elementArea';

type Pt2 = { x: number; y: number };
type Coord = { x: number; y: number; z: number };

export type LineOpeningClearanceSide = 'start' | 'end';

export interface LineHostedOpeningClearance {
  wallLengthM: number;
  openingLengthM: number;
  startDistanceM: number;
  endDistanceM: number;
  startPoint: Pt2;
  endPoint: Pt2;
  wallStart: Pt2;
  wallEnd: Pt2;
  startGuideSegment: [Pt2, Pt2];
  endGuideSegment: [Pt2, Pt2];
  openingSegment: [Pt2, Pt2];
  isWithinWall: boolean;
}

type OpeningElement = BuildingElementTransparent | BuildingElementOpaque;

const EPSILON_M = 1e-9;

export function isLineHostedOpeningElement(element: Element | undefined): element is OpeningElement {
  if (!element || !Array.isArray(element.coordinates) || element.coordinates.length !== 2) return false;
  if (element.type === 'BuildingElementTransparent') return true;
  return isOpaqueExternalDoorLineElement(element);
}

function finitePoint(point: { x: number; y: number } | undefined): point is Pt2 {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointAtDistance(origin: Pt2, ux: number, uy: number, distanceM: number): Pt2 {
  return {
    x: origin.x + ux * distanceM,
    y: origin.y + uy * distanceM,
  };
}

function projectionDistanceM(point: Pt2, origin: Pt2, ux: number, uy: number): number {
  return (point.x - origin.x) * ux + (point.y - origin.y) * uy;
}

export function computeLineHostedOpeningClearance(
  opening: Pick<OpeningElement, 'coordinates'>,
  parentWall: Pick<BuildingElementOpaque, 'coordinates'>,
): LineHostedOpeningClearance | null {
  const openingCoords = opening.coordinates ?? [];
  const wallCoords = parentWall.coordinates ?? [];
  if (openingCoords.length !== 2 || wallCoords.length !== 2) return null;

  const [wallA, wallB] = wallCoords;
  const [openingA, openingB] = openingCoords;
  if (!finitePoint(wallA) || !finitePoint(wallB) || !finitePoint(openingA) || !finitePoint(openingB)) {
    return null;
  }

  const wallDx = wallB.x - wallA.x;
  const wallDy = wallB.y - wallA.y;
  const wallLengthM = Math.hypot(wallDx, wallDy);
  if (wallLengthM <= EPSILON_M) return null;

  const ux = wallDx / wallLengthM;
  const uy = wallDy / wallLengthM;
  const aDistanceM = projectionDistanceM(openingA, wallA, ux, uy);
  const bDistanceM = projectionDistanceM(openingB, wallA, ux, uy);
  const startDistanceM = Math.min(aDistanceM, bDistanceM);
  const openingEndDistanceM = Math.max(aDistanceM, bDistanceM);
  const openingLengthM = openingEndDistanceM - startDistanceM;
  const endDistanceM = wallLengthM - openingEndDistanceM;
  const startPoint = pointAtDistance(wallA, ux, uy, startDistanceM);
  const endPoint = pointAtDistance(wallA, ux, uy, openingEndDistanceM);

  return {
    wallLengthM,
    openingLengthM,
    startDistanceM: Math.abs(startDistanceM) < EPSILON_M ? 0 : startDistanceM,
    endDistanceM: Math.abs(endDistanceM) < EPSILON_M ? 0 : endDistanceM,
    startPoint,
    endPoint,
    wallStart: { x: wallA.x, y: wallA.y },
    wallEnd: { x: wallB.x, y: wallB.y },
    startGuideSegment: [{ x: wallA.x, y: wallA.y }, startPoint],
    endGuideSegment: [endPoint, { x: wallB.x, y: wallB.y }],
    openingSegment: [startPoint, endPoint],
    isWithinWall: startDistanceM >= -EPSILON_M && endDistanceM >= -EPSILON_M,
  };
}

export function moveLineHostedOpeningToClearance(
  opening: Pick<OpeningElement, 'coordinates'>,
  parentWall: Pick<BuildingElementOpaque, 'coordinates'>,
  side: LineOpeningClearanceSide,
  targetDistanceM: number,
): Coord[] | null {
  if (!Number.isFinite(targetDistanceM) || targetDistanceM < 0) return null;

  const clearance = computeLineHostedOpeningClearance(opening, parentWall);
  if (!clearance) return null;
  if (targetDistanceM + clearance.openingLengthM > clearance.wallLengthM + EPSILON_M) return null;

  const wallCoords = parentWall.coordinates ?? [];
  const openingCoords = opening.coordinates ?? [];
  const [wallA, wallB] = wallCoords;
  const [openingA, openingB] = openingCoords as Coord[];
  if (!finitePoint(wallA) || !finitePoint(wallB) || !openingA || !openingB) return null;

  const ux = (wallB.x - wallA.x) / clearance.wallLengthM;
  const uy = (wallB.y - wallA.y) / clearance.wallLengthM;
  const openingADistanceM = projectionDistanceM(openingA, wallA, ux, uy);
  const openingBDistanceM = projectionDistanceM(openingB, wallA, ux, uy);
  const targetStartDistanceM =
    side === 'start'
      ? targetDistanceM
      : clearance.wallLengthM - targetDistanceM - clearance.openingLengthM;
  if (targetStartDistanceM < -EPSILON_M) return null;
  const targetEndDistanceM = targetStartDistanceM + clearance.openingLengthM;
  if (targetEndDistanceM > clearance.wallLengthM + EPSILON_M) return null;

  const firstDistanceM =
    openingADistanceM <= openingBDistanceM ? targetStartDistanceM : targetEndDistanceM;
  const secondDistanceM =
    openingADistanceM <= openingBDistanceM ? targetEndDistanceM : targetStartDistanceM;
  const firstPoint = pointAtDistance(wallA, ux, uy, firstDistanceM);
  const secondPoint = pointAtDistance(wallA, ux, uy, secondDistanceM);

  return [
    { ...openingA, x: firstPoint.x, y: firstPoint.y },
    { ...openingB, x: secondPoint.x, y: secondPoint.y },
  ];
}

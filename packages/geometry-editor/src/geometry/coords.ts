// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from './types';

// Coordinate management utilities
export const parseCoords = (coords?: string): Array<{ x: number; y: number; z: number }> => {
  if (!coords) return [{ x: 0, y: 0, z: 0 }];

  // Remove quotes and split by pipe
  const cleanCoords = coords.replace(/"/g, '');
  const points = cleanCoords.split('|');

  return points.map(point => {
    const [x, y, z] = point.split(',').map(Number);
    return {
      x: isNaN(x) ? 0 : x,
      y: isNaN(y) ? 0 : y,
      z: isNaN(z) ? 0 : z
    };
  });
};

export const formatCoords = (coordinates: Array<{ x: number; y: number; z: number }>): string => {
  const points = coordinates.map(coord =>
    `${coord.x.toFixed(3)},${coord.y.toFixed(3)},${coord.z.toFixed(3)}`
  );
  return `"${points.join('|')}"`;
};

export const updateElementCoordinates = (
  element: Element,
  coordinates: Array<{ x: number; y: number; z: number }>
): Partial<Element> => {
  return {
    ...element,
    coordinates,
    _v: (element._v ?? 0) + 1
  };
};

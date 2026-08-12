// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { getElementShape } from './shapeUtils';

export const ELEMENT_CATEGORY_GHOST_STORAGE_KEY = 'hem:elementCategoryGhost';
/** Multiplier applied to canvas/3D opacity for “hidden” categories (0 = fully invisible, still non-interactive). */
export const CATEGORY_GHOST_OPACITY_FACTOR = 0 as const;

export type ElementCategoryGhostKey =
  | 'thermalBridges'
  | 'onsiteGeneration'
  | 'ductwork'
  | 'pipework'
  | 'slopedRoofs'
  | 'vents';

/**
 * `true` means: elements in that category are fully hidden on 2D/3D (opacity 0, non-interactive);
 * the elements list is unchanged.
 */
export type ElementCategoryGhostState = Record<ElementCategoryGhostKey, boolean>;

export const ELEMENT_CATEGORY_GHOST_DEFAULTS: ElementCategoryGhostState = {
  thermalBridges: false,
  onsiteGeneration: false,
  ductwork: false,
  pipework: false,
  slopedRoofs: false,
  vents: false,
};

export const ELEMENT_CATEGORY_GHOST_OPTIONS: Array<{ key: ElementCategoryGhostKey; label: string }> = [
  { key: 'thermalBridges', label: 'Thermal bridges' },
  { key: 'onsiteGeneration', label: 'Onsite generation' },
  { key: 'ductwork', label: 'Ductwork' },
  { key: 'pipework', label: 'Pipework' },
  { key: 'slopedRoofs', label: 'Sloped roofs' },
  { key: 'vents', label: 'Vents' },
];

export function loadElementCategoryGhostState(): ElementCategoryGhostState {
  if (typeof localStorage === 'undefined') {
    return { ...ELEMENT_CATEGORY_GHOST_DEFAULTS };
  }
  try {
    const raw = localStorage.getItem(ELEMENT_CATEGORY_GHOST_STORAGE_KEY);
    if (!raw) return { ...ELEMENT_CATEGORY_GHOST_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<string, boolean>>;
    const out = { ...ELEMENT_CATEGORY_GHOST_DEFAULTS };
    for (const key of Object.keys(out) as ElementCategoryGhostKey[]) {
      if (typeof parsed[key] === 'boolean') {
        (out as Record<string, boolean>)[key] = parsed[key]!;
      }
    }
    return out;
  } catch {
    return { ...ELEMENT_CATEGORY_GHOST_DEFAULTS };
  }
}

export function saveElementCategoryGhostState(state: ElementCategoryGhostState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ELEMENT_CATEGORY_GHOST_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * When `true`, the element should be fully hidden on the view and not receive canvas/3D pointer input.
 */
export function elementIsCategoryGhost(element: Element, state: ElementCategoryGhostState): boolean {
  if (state.thermalBridges && (element.type === 'ThermalBridgeLinear' || element.type === 'ThermalBridgePoint')) {
    return true;
  }
  if (state.onsiteGeneration && element.type === 'OnSiteGeneration') {
    return true;
  }
  if (
    state.ductwork &&
    (element.type === 'MechanicalVentilationDuctwork' || element.type === 'MechanicalVentilationTerminal')
  ) {
    return true;
  }
  if (state.pipework && element.type === 'WaterPipework') {
    return true;
  }
  if (state.slopedRoofs && getElementShape(element) === 'sloped-polygon') {
    return true;
  }
  if (state.vents && element.type === 'Vents') {
    return true;
  }
  return false;
}

/**
 * View visibility: category ghost and/or per-element hide from the Elements panel.
 */
export function elementIsHiddenFromView(
  element: Element,
  categoryState: ElementCategoryGhostState,
  individuallyHiddenIds: ReadonlySet<string>,
): boolean {
  return elementIsCategoryGhost(element, categoryState) || individuallyHiddenIds.has(element.id);
}

/**
 * @see `meshStandardFloorDimmingProps` in `elementCanvasFloor3dMaterial`
 */
export function materialDimForCategoryGhost(
  dim: { opacity: number; transparent: boolean; depthWrite: boolean; wireframe: boolean },
  categoryGhost: boolean,
): { opacity: number; transparent: boolean; depthWrite: boolean; wireframe: boolean } {
  if (!categoryGhost) return dim;
  return {
    ...dim,
    opacity: dim.opacity * CATEGORY_GHOST_OPACITY_FACTOR,
    transparent: true,
    depthWrite: false,
    wireframe: false,
  };
}

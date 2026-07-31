// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolve which defaults-template nodes the CSV merge uses (mirrors hem-batch-core `index_templates`
 * behaviour for fabric BuildingElements). Used to edit the active defaults file in-place.
 */

import { classifyOpaqueFabricVariant } from './opaqueFabricVariant';

export type FabricMergeRole =
  | 'opaque_wall'
  | 'opaque_roof'
  | 'opaque_external_door'
  | 'ground'
  | 'adjacent_conditioned'
  | 'adjacent_unconditioned'
  | 'party_wall'
  | 'transparent';

export type FabricTemplatePointer = {
  zone: string;
  jsonKey: string;
  template: Record<string, unknown>;
};

const SINGLE_TYPES: { role: FabricMergeRole; type: string }[] = [
  { role: 'ground', type: 'BuildingElementGround' },
  { role: 'adjacent_conditioned', type: 'BuildingElementAdjacentConditionedSpace' },
  { role: 'adjacent_unconditioned', type: 'BuildingElementAdjacentUnconditionedSpace_Simple' },
  { role: 'party_wall', type: 'BuildingElementPartyWall' },
  { role: 'transparent', type: 'BuildingElementTransparent' },
];

/** Short section titles for the fabric defaults UI (order matches {@link FABRIC_MERGE_ROLES}). */
export const FABRIC_MERGE_ROLE_LABELS: Record<FabricMergeRole, string> = {
  opaque_wall: 'Wall',
  opaque_roof: 'Roof',
  opaque_external_door: 'External door',
  ground: 'Ground',
  adjacent_conditioned: 'Adjacent (conditioned)',
  adjacent_unconditioned: 'Adjacent (unconditioned)',
  party_wall: 'Party wall',
  transparent: 'Window',
};

export const FABRIC_MERGE_ROLES: FabricMergeRole[] = [
  'opaque_wall',
  'opaque_roof',
  'opaque_external_door',
  'ground',
  'adjacent_conditioned',
  'adjacent_unconditioned',
  'party_wall',
  'transparent',
];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Walk `defaults.Zone[*].BuildingElement` in key-insertion order (matches typical JSON parse order).
 * Opaque buckets use the same classification rules as merge; last matching template wins per bucket.
 * Other fabric types: last template of that `type` wins (matches merge `type_templates` overwrite).
 */
export function resolveFabricMergeTemplates(defaultsRoot: unknown): Map<FabricMergeRole, FabricTemplatePointer | null> {
  const out = new Map<FabricMergeRole, FabricTemplatePointer | null>();
  for (const r of FABRIC_MERGE_ROLES) out.set(r, null);

  const root = asRecord(defaultsRoot);
  const zones = root?.Zone as Record<string, unknown> | undefined;
  if (!zones || typeof zones !== 'object') return out;

  let opaqueWall: FabricTemplatePointer | null = null;
  let opaqueRoof: FabricTemplatePointer | null = null;
  let opaqueDoor: FabricTemplatePointer | null = null;
  const singles = new Map<FabricMergeRole, FabricTemplatePointer>();

  for (const zoneName of Object.keys(zones)) {
    const zone = asRecord(zones[zoneName]);
    const be = zone?.BuildingElement;
    const beObj = asRecord(be);
    if (!beObj) continue;

    for (const jsonKey of Object.keys(beObj)) {
      const el = asRecord(beObj[jsonKey]);
      if (!el) continue;
      const t = el.type;
      if (typeof t !== 'string') continue;

      if (t === 'BuildingElementOpaque') {
        const variant = classifyOpaqueFabricVariant(el);
        const ptr: FabricTemplatePointer = { zone: zoneName, jsonKey, template: el };
        if (variant === 'external_door') opaqueDoor = ptr;
        else if (variant === 'roof') opaqueRoof = ptr;
        else opaqueWall = ptr;
        continue;
      }

      for (const { role, type } of SINGLE_TYPES) {
        if (t === type) {
          singles.set(role, { zone: zoneName, jsonKey, template: el });
        }
      }
    }
  }

  out.set('opaque_wall', opaqueWall);
  out.set('opaque_roof', opaqueRoof);
  out.set('opaque_external_door', opaqueDoor);
  for (const { role } of SINGLE_TYPES) {
    out.set(role, singles.get(role) ?? null);
  }

  return out;
}

export function elementTypeForFabricRole(role: FabricMergeRole): string {
  switch (role) {
    case 'opaque_wall':
    case 'opaque_roof':
    case 'opaque_external_door':
      return 'BuildingElementOpaque';
    case 'ground':
      return 'BuildingElementGround';
    case 'adjacent_conditioned':
      return 'BuildingElementAdjacentConditionedSpace';
    case 'adjacent_unconditioned':
      return 'BuildingElementAdjacentUnconditionedSpace_Simple';
    case 'party_wall':
      return 'BuildingElementPartyWall';
    case 'transparent':
      return 'BuildingElementTransparent';
    default:
      return 'BuildingElementOpaque';
  }
}

export function subtypeForFabricRole(role: FabricMergeRole, template: Record<string, unknown>): string | undefined {
  if (role !== 'ground') return undefined;
  const ft = template.floor_type;
  return typeof ft === 'string' && ft.trim() !== '' ? ft.trim() : undefined;
}

/** Deep clone defaults and shallow-merge `updates[role]` onto each resolved template node. */
export function applyFabricMergeTemplateUpdates(
  defaultsRoot: unknown,
  resolved: Map<FabricMergeRole, FabricTemplatePointer | null>,
  updates: Partial<Record<FabricMergeRole, Record<string, unknown>>>,
): unknown {
  const clone = defaultsRoot === undefined ? {} : JSON.parse(JSON.stringify(defaultsRoot));
  const root = asRecord(clone);
  const zoneBag = root?.Zone as Record<string, unknown> | undefined;
  if (!zoneBag || typeof zoneBag !== 'object') return clone;

  for (const role of FABRIC_MERGE_ROLES) {
    const patch = updates[role];
    if (!patch || typeof patch !== 'object') continue;
    const loc = resolved.get(role);
    if (!loc) continue;

    const zone = asRecord(zoneBag[loc.zone]);
    if (!zone) continue;
    const be = asRecord(zone.BuildingElement);
    if (!be) continue;
    const node = asRecord(be[loc.jsonKey]);
    if (!node) continue;

    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) {
        delete node[k];
      } else {
        node[k] = v;
      }
    }
    be[loc.jsonKey] = node;
    zone.BuildingElement = be;
    zoneBag[loc.zone] = zone;
  }

  return clone;
}
